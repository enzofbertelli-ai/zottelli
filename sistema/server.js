const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Middleware para diferenciar domínios: zottelli.com.br (Site) vs sistema.zottelli.com.br (Sistema)
app.get('/', (req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('sistema.')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    if (host.includes('zottelli.com.br')) {
        return res.sendFile(path.join(__dirname, 'public', 'site.html'));
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
// MULTER (upload de fotos – showroom)
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `showroom_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Apenas imagens são permitidas'));
        cb(null, true);
    }
});

// ============================================================
// CRIPTOGRAFIA (AES-256-CTR)
// ============================================================
const ENC_KEY = Buffer.alloc(32);
Buffer.from('ZottelliSelection_SecretKey_v1!').copy(ENC_KEY);

function encryptNum(num) {
    if (num === null || num === undefined || num === '' || Number(num) === 0) return '0';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-ctr', ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(String(num)), cipher.final()]);
    return iv.toString('hex') + ':' + enc.toString('hex');
}
function decryptNum(str) {
    if (!str || str === '0') return 0;
    if (!str.includes(':')) return parseFloat(str) || 0;
    try {
        const [ivHex, encHex] = str.split(':');
        const decipher = crypto.createDecipheriv('aes-256-ctr', ENC_KEY, Buffer.from(ivHex, 'hex'));
        const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
        return parseFloat(dec.toString()) || 0;
    } catch { return 0; }
}
function nowISO() { return new Date().toISOString(); }

// ============================================================
// BANCO DE DADOS
// ============================================================
const db = new sqlite3.Database('./loja.db', (err) => {
    if (err) console.error('Erro ao abrir o banco:', err.message);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE, password_hash TEXT,
        cargo TEXT DEFAULT 'funcionario', status TEXT DEFAULT 'ativo'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transportes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, carro TEXT, placa TEXT, fonte TEXT, transportadora TEXT,
        valor REAL DEFAULT 0, pago INTEGER DEFAULT 0, status TEXT DEFAULT 'Documentação', data_inclusao TEXT,
        dia_pedido TEXT, dia_coleta TEXT, dia_entrega TEXT, origem TEXT, arquivado INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS frota (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        modelo TEXT, placa TEXT, ano TEXT, origem TEXT, destino TEXT,
        custo_compra TEXT DEFAULT '0', custo_transporte TEXT DEFAULT '0',
        custo_taxas REAL DEFAULT 0, custo_geral REAL DEFAULT 0, custo_geral_detalhes TEXT DEFAULT '[]',
        custo_painel REAL DEFAULT 0, custo_despachante REAL DEFAULT 0, custo_funilaria REAL DEFAULT 0,
        preco_venda TEXT DEFAULT '0', status TEXT DEFAULT 'Estoque',
        dono TEXT, socio TEXT,
        data_compra TEXT, data_pagamento TEXT, data_venda TEXT,
        kanban_col TEXT DEFAULT 'Na Loja C/ Pendências',
        chave_reserva INTEGER DEFAULT 0,
        manual_original INTEGER DEFAULT 0, manual_atual INTEGER DEFAULT 0,
        km_original REAL DEFAULT 0, km_nova REAL DEFAULT 0
    )`);

    // migrações seguras para bancos já existentes
    ['kanban_col TEXT DEFAULT \'Na Loja C/ Pendências\'',
        'chave_reserva INTEGER DEFAULT 0',
        'manual_original INTEGER DEFAULT 0', 'manual_atual INTEGER DEFAULT 0',
        'km_original REAL DEFAULT 0', 'km_nova REAL DEFAULT 0'
    ].forEach(col => db.run(`ALTER TABLE frota ADD COLUMN ${col}`, () => { }));

    db.run(`CREATE TABLE IF NOT EXISTS frota_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frota_id INTEGER, usuario TEXT, acao TEXT, detalhes TEXT, data_hora TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        de_usuario TEXT NOT NULL, para_usuario TEXT NOT NULL,
        descricao TEXT NOT NULL, valor REAL NOT NULL, data TEXT NOT NULL,
        liquidado INTEGER DEFAULT 0, data_liquidacao TEXT,
        criado_por TEXT, criado_em TEXT
    )`);

    // Tabela do módulo Despachante
    db.run(`CREATE TABLE IF NOT EXISTS despachante (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frota_id INTEGER UNIQUE NOT NULL,
        vistoriado_data TEXT,
        dut TEXT DEFAULT 'Não',
        dut_assinado TEXT DEFAULT 'Não',
        status TEXT DEFAULT 'Pendente',
        nf TEXT DEFAULT 'Pendente',
        google_drive_link TEXT,
        arquivado INTEGER DEFAULT 0,
        atualizado_em TEXT,
        atualizado_por TEXT
    )`);
    // migrate despachante if already exists
    ['google_drive_link TEXT', 'arquivado INTEGER DEFAULT 0'
    ].forEach(col => db.run(`ALTER TABLE despachante ADD COLUMN ${col}`, () => {}));

    // Tabela Showroom (vitrine pública)
    db.run(`CREATE TABLE IF NOT EXISTS showroom (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        modelo TEXT NOT NULL,
        ano TEXT,
        preco TEXT,
        descricao TEXT,
        foto_url TEXT,
        destaque INTEGER DEFAULT 0,
        ativo INTEGER DEFAULT 1,
        ordem INTEGER DEFAULT 0,
        criado_em TEXT,
        atualizado_em TEXT
    )`);
    ['destaque INTEGER DEFAULT 0', 'ordem INTEGER DEFAULT 0',
     'preco_fipe TEXT', 'vendido_em TEXT'
    ].forEach(col => db.run(`ALTER TABLE showroom ADD COLUMN ${col}`, () => {}));

    // Tabela de Sessões (rastreio de login)
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        login_em TEXT,
        last_seen TEXT,
        ativa INTEGER DEFAULT 1
    )`);

    // Tabela Compras (avaliação de veículos para compra)
    db.run(`CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link TEXT,
        modelo TEXT,
        preco_fipe TEXT,
        tag TEXT DEFAULT 'Regular',
        prazo_encerramento TEXT,
        proposta TEXT,
        notas TEXT,
        status TEXT DEFAULT 'Avaliando',
        criado_por TEXT,
        criado_em TEXT,
        atualizado_em TEXT
    )`);

    // Tabela Custos Rápidos (lançamentos de campo)
    db.run(`CREATE TABLE IF NOT EXISTS custos_rapidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        categoria TEXT DEFAULT 'Geral',
        carro_ref TEXT,
        usuario TEXT,
        data_hora TEXT
    )`);
    ['carro_ref TEXT'].forEach(col => db.run(`ALTER TABLE custos_rapidos ADD COLUMN ${col}`, () => {}));

    // Tabela Tarefas (to-do list)
    db.run(`CREATE TABLE IF NOT EXISTS tarefas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descricao TEXT,
        prioridade TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pendente',
        criado_por TEXT,
        atribuido_para TEXT,
        prazo TEXT,
        criado_em TEXT,
        concluido_em TEXT
    )`);

    // Seed: usuários padrão somente se não existirem
    const criarUsuario = async (username, pwd, cargo) => {
        db.get(`SELECT id FROM usuarios WHERE username = ?`, [username], async (err, row) => {
            if (!row) {
                const hash = await bcrypt.hash(pwd, 10);
                db.run(`INSERT INTO usuarios (username, password_hash, cargo, status) VALUES (?,?,?,'ativo')`, [username, hash, cargo]);
                console.log(`✅ Usuário "${username}" criado com sucesso.`);
            }
        });
    };
    
    // ATENÇÃO: Senha padrão para a VPS configurada como 123456
    criarUsuario('admin', '123456', 'admin');
    criarUsuario('funcionario', '123456', 'funcionario');

    // === SEEDS DE DADOS DE TESTE REMOVIDOS PARA PRODUÇÃO ===
    // O banco de dados iniciará 100% vazio e limpo para o uso real.
    // As tabelas ainda são criadas vazias usando CREATE TABLE IF NOT EXISTS acima.
});


// ============================================================
// BACKUP AUTOMÁTICO DO BANCO DE DADOS (A cada 24h)
// ============================================================
function realizarBackupDb() {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const dataAtual = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dbFile = path.join(__dirname, 'loja.db');
    const backupFile = path.join(backupDir, `loja_backup_${dataAtual}.db`);

    // Faz uma cópia física do arquivo
    fs.copyFile(dbFile, backupFile, (err) => {
        if (err) console.error('Erro ao realizar backup do banco de dados:', err);
        else console.log(`✅ Backup do banco de dados realizado: ${backupFile}`);
    });

    // Limpeza de backups antigos (mantém os últimos 14 dias)
    fs.readdir(backupDir, (err, files) => {
        if (err) return;
        const limiteData = new Date();
        limiteData.setDate(limiteData.getDate() - 14);

        files.forEach(file => {
            const filePath = path.join(backupDir, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && stats.mtime < limiteData) {
                    fs.unlink(filePath, () => console.log(`🗑️ Backup antigo removido: ${file}`));
                }
            });
        });
    });
}

// Inicia o job de backup (roda uma vez na inicialização, depois a cada 24 horas)
setTimeout(realizarBackupDb, 5000); // Roda 5 seg após o início do servidor
setInterval(realizarBackupDb, 24 * 60 * 60 * 1000);

// ============================================================
// HELPERS
// ============================================================
function checkAdmin(req, res, next) {
    const u = req.headers['x-username'];
    if (!u) return res.status(401).json({ erro: 'Não autenticado.' });
    db.get(`SELECT cargo FROM usuarios WHERE username = ? AND status = 'ativo'`, [u], (err, user) => {
        if (!user || user.cargo !== 'admin') return res.status(403).json({ erro: 'Acesso negado.' });
        req.adminUser = u; next();
    });
}

function buildCarResponse(car, username) {
    const isDono = !car.dono || car.dono === username || car.socio === username;
    return {
        id: car.id, modelo: car.modelo, placa: car.placa, ano: car.ano, status: car.status,
        kanban_col: car.kanban_col || 'Na Loja C/ Pendências',
        chave_reserva: car.chave_reserva || 0,
        manual_original: car.manual_original || 0, manual_atual: car.manual_atual || 0,
        km_original: car.km_original || 0, km_nova: car.km_nova || 0,
        custo_taxas: car.custo_taxas || 0, custo_geral: car.custo_geral || 0,
        custo_geral_detalhes: car.custo_geral_detalhes || '[]',
        custo_painel: car.custo_painel || 0, custo_despachante: car.custo_despachante || 0,
        custo_funilaria: car.custo_funilaria || 0,
        custo_compra: isDono ? decryptNum(car.custo_compra) : null,
        custo_transporte: isDono ? decryptNum(car.custo_transporte) : null,
        preco_venda: isDono ? decryptNum(car.preco_venda) : null,
        origem: isDono ? car.origem : null, destino: isDono ? car.destino : null,
        data_compra: isDono ? car.data_compra : null,
        data_pagamento: isDono ? car.data_pagamento : null,
        data_venda: isDono ? car.data_venda : null,
        socio: isDono ? car.socio : null, _isDono: isDono,
    };
}

// ============================================================
// AUTH
// ============================================================
// ============================================================
// AUTH — com Session Tokens
// ============================================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'desconhecido';
    const ua = req.headers['user-agent'] || '';

    db.get(`SELECT * FROM usuarios WHERE username = ?`, [username], async (err, user) => {
        if (!user) return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
        if (user.status === 'pendente') return res.status(403).json({ erro: 'Aguarda aprovação do administrador.' });
        if (user.status === 'rejeitado') return res.status(403).json({ erro: 'Acesso recusado. Contate o administrador.' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });

        // Busca último login ANTES de invalidar
        db.get(`SELECT ip, user_agent, login_em FROM sessions WHERE username = ? AND ativa = 1 ORDER BY login_em DESC LIMIT 1`,
            [username], (err2, lastSession) => {

            // Invalida todas as sessões ativas desse user (sem logins simultâneos)
            db.run(`UPDATE sessions SET ativa = 0 WHERE username = ?`, [username]);

            // Cria nova sessão
            const token = crypto.randomBytes(32).toString('hex');
            db.run(`INSERT INTO sessions (token, username, ip, user_agent, login_em, last_seen, ativa) VALUES (?,?,?,?,?,?,1)`,
                [token, username, ip, ua, nowISO(), nowISO()]);

            res.json({
                sucesso: true,
                token,
                user: { username: user.username, cargo: user.cargo },
                ultimoLogin: lastSession ? {
                    ip: lastSession.ip,
                    ua: lastSession.user_agent,
                    em: lastSession.login_em
                } : null
            });
        });
    });
});

// Heartbeat — mantém sessão viva
app.post('/api/sessao/ping', (req, res) => {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ erro: 'Sem token.' });
    db.run(`UPDATE sessions SET last_seen = ? WHERE token = ? AND ativa = 1`, [nowISO(), token], function(err) {
        if (this.changes === 0) return res.status(401).json({ erro: 'Sessão inválida.' });
        res.json({ ok: true });
    });
});

// Logout
app.post('/api/sessao/logout', (req, res) => {
    const token = req.headers['x-token'];
    if (token) db.run(`UPDATE sessions SET ativa = 0 WHERE token = ?`, [token]);
    res.json({ ok: true });
});

// Quem está online (last_seen < 8min)
app.get('/api/sessao/online', (req, res) => {
    const threshold = new Date(Date.now() - 8 * 60 * 1000).toISOString();
    db.all(`SELECT username, last_seen, ip FROM sessions WHERE ativa = 1 AND last_seen > ? ORDER BY last_seen DESC`,
        [threshold], (err, rows) => res.json(rows || []));
});

app.post('/api/registro', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ erro: 'Informe usuário e senha.' });
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO usuarios (username, password_hash, cargo, status) VALUES (?,?,'funcionario','pendente')`,
        [username, hash], function (err) {
            if (err) return res.status(400).json({ erro: 'Usuário já existe.' });
            res.json({ sucesso: true });
        });
});

// ============================================================
// USUÁRIOS
// ============================================================
app.get('/api/usuarios', checkAdmin, (req, res) => {
    db.all(`SELECT id, username, cargo, status FROM usuarios ORDER BY status ASC, username ASC`, [], (err, rows) => res.json(rows || []));
});
app.get('/api/usuarios/lista', (req, res) => {
    db.all(`SELECT username FROM usuarios WHERE status = 'ativo' ORDER BY username ASC`, [], (err, rows) => res.json((rows || []).map(r => r.username)));
});
app.put('/api/usuarios/:id', checkAdmin, async (req, res) => {
    const { cargo, status, nova_senha } = req.body;
    if (nova_senha) {
        const hash = await bcrypt.hash(nova_senha, 10);
        db.run(`UPDATE usuarios SET password_hash = ? WHERE id = ?`, [hash, req.params.id], () => res.json({ sucesso: true }));
    } else {
        db.run(`UPDATE usuarios SET cargo = ?, status = ? WHERE id = ?`, [cargo, status, req.params.id], () => res.json({ sucesso: true }));
    }
});
app.delete('/api/usuarios/:id', checkAdmin, (req, res) => {
    db.run(`DELETE FROM usuarios WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
});

// ============================================================
// TRANSPORTES
// ============================================================
app.get('/api/transportes', (req, res) => {
    db.all(`SELECT * FROM transportes ORDER BY id ASC`, [], (err, rows) => res.json(rows || []));
});
app.post('/api/transportes', (req, res) => {
    const { carro, placa, fonte, transportadora, valor, data_inclusao, origem } = req.body;
    db.run(`INSERT INTO transportes (carro,placa,fonte,transportadora,valor,data_inclusao,origem) VALUES (?,?,?,?,?,?,?)`,
        [carro, placa, fonte, transportadora, valor || 0, data_inclusao, origem], function (err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID });
        });
});
app.put('/api/transportes/:id', (req, res) => {
    const { carro, placa, fonte, transportadora, valor, pago, status, dia_pedido, dia_coleta, dia_entrega, origem, arquivado } = req.body;
    db.run(`UPDATE transportes SET carro=?,placa=?,fonte=?,transportadora=?,valor=?,pago=?,status=?,dia_pedido=?,dia_coleta=?,dia_entrega=?,origem=?,arquivado=? WHERE id=?`,
        [carro, placa, fonte, transportadora, valor || 0, pago, status, dia_pedido, dia_coleta, dia_entrega, origem, arquivado, req.params.id],
        (err) => { if (err) return res.status(500).json({ erro: err.message }); res.json({ sucesso: true }); });
});
app.delete('/api/transportes/:id', (req, res) => {
    db.run(`DELETE FROM transportes WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ erro: err.message }); res.json({ sucesso: true });
    });
});
app.get('/api/transportes/custo/:placa', (req, res) => {
    db.get(`SELECT valor FROM transportes WHERE placa = ? ORDER BY id DESC LIMIT 1`, [req.params.placa], (err, row) => {
        res.json({ valor: row ? (row.valor || 0) : 0 });
    });
});

// ============================================================
// FROTA
// ============================================================
app.get('/api/frota', (req, res) => {
    const username = req.headers['x-username'] || null;
    db.all(`SELECT f.*, d.status as desp_status FROM frota f LEFT JOIN despachante d ON d.frota_id = f.id ORDER BY f.id DESC`, [], (err, rows) => {
        res.json((rows || []).map(car => ({ ...buildCarResponse(car, username), desp_status: car.desp_status || 'Pendente' })));
    });
});

app.post('/api/frota', (req, res) => {
    const { modelo, placa, ano, origem, custo_compra, data_compra } = req.body;
    const dono = req.headers['x-username'] || null;
    db.run(`INSERT INTO frota (modelo,placa,ano,origem,custo_compra,dono,data_compra,kanban_col) VALUES (?,?,?,?,?,?,?,?)`,
        [modelo, placa, ano, origem, encryptNum(custo_compra), dono, data_compra || null, 'Transportadora'],
        function (err) {
            if (err) return res.status(500).json({ erro: err.message });
            const id = this.lastID;
            db.run(`INSERT INTO frota_logs (frota_id,usuario,acao,detalhes,data_hora) VALUES (?,?,?,?,?)`,
                [id, dono, 'Compra Registrada', JSON.stringify({ modelo, placa, ano, custo_compra, origem }), nowISO()]);
            db.run(`INSERT INTO despachante (frota_id,status,nf,atualizado_em,atualizado_por) VALUES (?,?,?,?,?)`,
                [id, 'Pendente', 'Pendente', nowISO(), dono]);
            res.json({ id });
        });
});

app.put('/api/frota/:id', (req, res) => {
    const d = req.body;
    const username = req.headers['x-username'] || null;
    const id = req.params.id;
    db.get(`SELECT * FROM frota WHERE id = ?`, [id], (err, car) => {
        if (!car) return res.status(404).json({ erro: 'Veículo não encontrado.' });
        const isDono = !car.dono || car.dono === username || car.socio === username;
        const detalhesJSON = JSON.stringify(d.custo_geral_detalhes || []);
        let sql, params;
        if (isDono) {
            sql = `UPDATE frota SET modelo=?,placa=?,ano=?,origem=?,destino=?,custo_compra=?,custo_transporte=?,custo_taxas=?,custo_geral=?,custo_geral_detalhes=?,custo_painel=?,custo_despachante=?,custo_funilaria=?,preco_venda=?,status=?,socio=?,data_compra=?,data_pagamento=?,data_venda=?,chave_reserva=?,manual_original=?,manual_atual=?,km_original=?,km_nova=? WHERE id=?`;
            params = [d.modelo, d.placa, d.ano, d.origem, d.destino, encryptNum(d.custo_compra), encryptNum(d.custo_transporte), d.custo_taxas, d.custo_geral, detalhesJSON, d.custo_painel, d.custo_despachante, d.custo_funilaria, encryptNum(d.preco_venda), d.status, d.socio || null, d.data_compra || null, d.data_pagamento || null, d.data_venda || null, d.chave_reserva || 0, d.manual_original || 0, d.manual_atual || 0, d.km_original || 0, d.km_nova || 0, id];
        } else {
            sql = `UPDATE frota SET custo_taxas=?,custo_despachante=?,custo_funilaria=?,custo_painel=?,custo_geral=?,custo_geral_detalhes=?,chave_reserva=?,manual_original=?,manual_atual=?,km_original=?,km_nova=? WHERE id=?`;
            params = [d.custo_taxas, d.custo_despachante, d.custo_funilaria, d.custo_painel, d.custo_geral, detalhesJSON, d.chave_reserva || 0, d.manual_original || 0, d.manual_atual || 0, d.km_original || 0, d.km_nova || 0, id];
        }
        db.run(sql, params, () => {
            db.run(`INSERT INTO frota_logs (frota_id,usuario,acao,detalhes,data_hora) VALUES (?,?,?,?,?)`,
                [id, username, isDono ? 'Edição (Dono)' : 'Edição (Parcial)', JSON.stringify({ status: d.status }), nowISO()]);
            res.json({ sucesso: true, isDono });
        });
    });
});

// Mover card no Kanban
app.put('/api/frota/:id/kanban', (req, res) => {
    const { kanban_col } = req.body;
    const username = req.headers['x-username'] || 'sistema';
    if (!kanban_col) return res.status(400).json({ erro: 'coluna não informada.' });
    db.run(`UPDATE frota SET kanban_col = ? WHERE id = ?`, [kanban_col, req.params.id], () => {
        db.run(`INSERT INTO frota_logs (frota_id,usuario,acao,detalhes,data_hora) VALUES (?,?,?,?,?)`,
            [req.params.id, username, 'Kanban Movido', JSON.stringify({ para: kanban_col }), nowISO()]);
        res.json({ sucesso: true });
    });
});

app.delete('/api/frota/:id', (req, res) => {
    const username = req.headers['x-username'] || 'desconhecido';
    db.get(`SELECT modelo, placa FROM frota WHERE id = ?`, [req.params.id], (err, car) => {
        db.run(`INSERT INTO frota_logs (frota_id,usuario,acao,detalhes,data_hora) VALUES (?,?,?,?,?)`,
            [req.params.id, username, 'Veículo Removido', JSON.stringify({ modelo: car?.modelo, placa: car?.placa }), nowISO()]);
        db.run(`DELETE FROM frota WHERE id = ?`, req.params.id, () => res.json({ sucesso: true }));
    });
});

app.get('/api/frota/:id/logs', (req, res) => {
    const username = req.headers['x-username'] || null;
    db.get(`SELECT dono, socio FROM frota WHERE id = ?`, [req.params.id], (err, car) => {
        if (!car) return res.status(404).json({ erro: 'Não encontrado.' });
        if (car.dono && car.dono !== username && car.socio !== username) return res.status(403).json({ erro: 'Acesso negado.' });
        db.all(`SELECT * FROM frota_logs WHERE frota_id = ? ORDER BY data_hora DESC`, [req.params.id], (err, logs) => res.json(logs || []));
    });
});

// ============================================================
// DESPACHANTE
// ============================================================
app.get('/api/despachante', (req, res) => {
    const showArquivados = req.query.arquivados === '1';
    db.all(`SELECT d.*, f.modelo, f.placa, f.ano, f.dono FROM despachante d JOIN frota f ON f.id = d.frota_id WHERE d.arquivado = ? ORDER BY d.id ASC`, [showArquivados ? 1 : 0], (err, rows) => res.json(rows || []));
});

app.get('/api/despachante/:frota_id', (req, res) => {
    db.get(`SELECT d.*, f.modelo, f.placa FROM despachante d JOIN frota f ON f.id = d.frota_id WHERE d.frota_id = ?`, [req.params.frota_id], (err, row) => {
        if (!row) return res.status(404).json({ erro: 'Não encontrado.' });
        res.json(row);
    });
});

app.put('/api/despachante/:frota_id', (req, res) => {
    const username = req.headers['x-username'] || 'sistema';
    const { vistoriado_data, dut, dut_assinado, status, nf, google_drive_link } = req.body;
    db.run(`INSERT INTO despachante (frota_id, vistoriado_data, dut, dut_assinado, status, nf, google_drive_link, atualizado_em, atualizado_por) VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(frota_id) DO UPDATE SET vistoriado_data=excluded.vistoriado_data, dut=excluded.dut, dut_assinado=excluded.dut_assinado, status=excluded.status, nf=excluded.nf, google_drive_link=excluded.google_drive_link, atualizado_em=excluded.atualizado_em, atualizado_por=excluded.atualizado_por`,
        [req.params.frota_id, vistoriado_data || null, dut || 'Não', dut_assinado || 'Não', status || 'Pendente', nf || 'Pendente', google_drive_link || null, nowISO(), username],
        (err) => {
            if (err) return res.status(500).json({ erro: err.message });
            db.run(`INSERT INTO frota_logs (frota_id,usuario,acao,detalhes,data_hora) VALUES (?,?,?,?,?)`,
                [req.params.frota_id, username, 'Despachante Atualizado', JSON.stringify({ status, nf }), nowISO()]);
            res.json({ sucesso: true });
        });
});

// Archive / unarchive despachante
app.put('/api/despachante/:frota_id/arquivar', (req, res) => {
    const { arquivado } = req.body;
    db.run(`UPDATE despachante SET arquivado = ? WHERE frota_id = ?`, [arquivado ? 1 : 0, req.params.frota_id], () => res.json({ sucesso: true }));
});

// ============================================================
// CONTAS
// ============================================================
app.get('/api/contas', (req, res) => {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ erro: 'Não autenticado.' });
    db.all(`SELECT * FROM contas WHERE de_usuario = ? OR para_usuario = ? ORDER BY data DESC, id DESC`,
        [username, username], (err, rows) => res.json(rows || []));
});
app.post('/api/contas', (req, res) => {
    const { de_usuario, para_usuario, descricao, valor, data } = req.body;
    const criado_por = req.headers['x-username'];
    if (!de_usuario || !para_usuario || !descricao || !valor || !data) return res.status(400).json({ erro: 'Preencha todos os campos.' });
    db.run(`INSERT INTO contas (de_usuario,para_usuario,descricao,valor,data,criado_por,criado_em) VALUES (?,?,?,?,?,?,?)`,
        [de_usuario, para_usuario, descricao, valor, data, criado_por, nowISO()], function (err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID });
        });
});
app.put('/api/contas/:id/liquidar', (req, res) => {
    db.run(`UPDATE contas SET liquidado = 1, data_liquidacao = ? WHERE id = ?`, [nowISO(), req.params.id], () => res.json({ sucesso: true }));
});
app.delete('/api/contas/:id', (req, res) => {
    db.run(`DELETE FROM contas WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
});

// ============================================================
// DASHBOARD
// ============================================================
app.get('/api/dashboard', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM frota WHERE status = 'Estoque'`, [], (err, r1) => {
        db.get(`SELECT COUNT(*) as count FROM transportes WHERE arquivado = 0 AND status != 'Entregue'`, [], (err, r2) => {
            db.all(`SELECT custo_compra,custo_transporte,custo_taxas,custo_geral,custo_painel,custo_despachante,custo_funilaria,preco_venda FROM frota WHERE status = 'Vendido'`, [], (err, rows) => {
                let lucro = 0;
                (rows || []).forEach(car => {
                    const total = decryptNum(car.custo_compra) + decryptNum(car.custo_transporte) + (car.custo_taxas || 0) + (car.custo_geral || 0) + (car.custo_painel || 0) + (car.custo_despachante || 0) + (car.custo_funilaria || 0);
                    lucro += decryptNum(car.preco_venda) - total;
                });
                db.get(`SELECT AVG(valor) as avg FROM transportes WHERE valor > 0`, [], (err, r3) => {
                    db.get(`SELECT COUNT(*) as count FROM tarefas WHERE status != 'Concluída'`, [], (err, r4) => {
                        db.get(`SELECT SUM(valor) as sum FROM custos_rapidos WHERE strftime('%Y-%m', data_hora) = strftime('%Y-%m', 'now')`, [], (err, r5) => {
                            db.get(`SELECT COUNT(*) as count FROM compras WHERE status = 'Avaliação'`, [], (err, r6) => {
                                db.get(`SELECT COUNT(*) as count FROM showroom WHERE ativo = 1`, [], (err, r7) => {
                                    res.json({ 
                                        estoque: r1?.count || 0, 
                                        transito: r2?.count || 0, 
                                        lucroAcumulado: lucro, 
                                        custoMedioFrete: r3?.avg || 0,
                                        tarefasPendentes: r4?.count || 0,
                                        gastosMes: r5?.sum || 0,
                                        comprasAvaliacao: r6?.count || 0,
                                        showroomAtivos: r7?.count || 0
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// ============================================================
// SHOWROOM
// ============================================================

// GET público – apenas ativos, ordenados
app.get('/api/showroom', (req, res) => {
    const apenasAtivos = req.query.todos !== '1';
    const sql = apenasAtivos
        ? `SELECT * FROM showroom WHERE ativo = 1 ORDER BY destaque DESC, ordem ASC, id DESC`
        : `SELECT * FROM showroom ORDER BY destaque DESC, ordem ASC, id DESC`;
    db.all(sql, [], (err, rows) => res.json(rows || []));
});

// POST – criar carro no showroom (todos os usuários)
app.post('/api/showroom', upload.single('foto'), (req, res) => {
    const { modelo, ano, preco, preco_fipe, descricao, destaque, ativo, ordem } = req.body;
    const foto_url = req.file ? `/uploads/${req.file.filename}` : null;
    db.run(`INSERT INTO showroom (modelo,ano,preco,preco_fipe,descricao,foto_url,destaque,ativo,ordem,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [modelo, ano || null, preco || null, preco_fipe || null, descricao || null, foto_url, destaque === '1' ? 1 : 0, ativo === '0' ? 0 : 1, ordem || 0, nowISO(), nowISO()],
        function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID, foto_url });
        });
});

// PUT – editar carro do showroom (todos os usuários)
app.put('/api/showroom/:id', upload.single('foto'), (req, res) => {
    const { modelo, ano, preco, preco_fipe, descricao, destaque, ativo, ordem } = req.body;
    const id = req.params.id;
    if (req.file) {
        db.get(`SELECT foto_url FROM showroom WHERE id = ?`, [id], (err, row) => {
            if (row && row.foto_url) {
                const oldPath = path.join(__dirname, row.foto_url);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        });
    }
    const foto_url = req.file ? `/uploads/${req.file.filename}` : undefined;
    const params = foto_url !== undefined
        ? [modelo, ano || null, preco || null, preco_fipe || null, descricao || null, foto_url, destaque === '1' ? 1 : 0, ativo === '0' ? 0 : 1, ordem || 0, nowISO(), id]
        : [modelo, ano || null, preco || null, preco_fipe || null, descricao || null, destaque === '1' ? 1 : 0, ativo === '0' ? 0 : 1, ordem || 0, nowISO(), id];
    const sql = foto_url !== undefined
        ? `UPDATE showroom SET modelo=?,ano=?,preco=?,preco_fipe=?,descricao=?,foto_url=?,destaque=?,ativo=?,ordem=?,atualizado_em=? WHERE id=?`
        : `UPDATE showroom SET modelo=?,ano=?,preco=?,preco_fipe=?,descricao=?,destaque=?,ativo=?,ordem=?,atualizado_em=? WHERE id=?`;
    db.run(sql, params, (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true, foto_url });
    });
});

// PATCH – marcar como vendido
app.patch('/api/showroom/:id/vendido', (req, res) => {
    const { vendido } = req.body;
    const val = vendido ? nowISO() : null;
    db.run(`UPDATE showroom SET vendido_em = ? WHERE id = ?`, [val, req.params.id], (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

// DELETE – remover carro do showroom (todos os usuários)
app.delete('/api/showroom/:id', (req, res) => {
    db.get(`SELECT foto_url FROM showroom WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.foto_url) {
            const oldPath = path.join(__dirname, row.foto_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        db.run(`DELETE FROM showroom WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
    });
});

// ============================================================
// AUTO-DELETE: carros vendidos há +10 dias
// ============================================================
function limparVendidosAntigos() {
    const limite = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.all(`SELECT id, foto_url FROM showroom WHERE vendido_em IS NOT NULL AND vendido_em < ?`, [limite], (err, rows) => {
        if (!rows || !rows.length) return;
        rows.forEach(row => {
            if (row.foto_url) {
                const p = path.join(__dirname, row.foto_url);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            db.run(`DELETE FROM showroom WHERE id = ?`, [row.id]);
        });
        console.log(`🗑 Auto-delete: ${rows.length} carro(s) vendido(s) removido(s).`);
    });
}
limparVendidosAntigos();
setInterval(limparVendidosAntigos, 6 * 60 * 60 * 1000); // a cada 6h

// ============================================================
// COMPRAS
// ============================================================
app.get('/api/compras', checkAdmin, (req, res) => {
    db.all(`SELECT * FROM compras ORDER BY criado_em DESC`, [], (err, rows) => res.json(rows || []));
});
app.post('/api/compras', checkAdmin, (req, res) => {
    const { link, modelo, preco_fipe, tag, prazo_encerramento, proposta, notas, status } = req.body;
    const criado_por = req.headers['x-username'] || 'admin';
    db.run(`INSERT INTO compras (link,modelo,preco_fipe,tag,prazo_encerramento,proposta,notas,status,criado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [link||null, modelo||null, preco_fipe||null, tag||'Esperando', prazo_encerramento||null, proposta||null, notas||null, status||'Avaliando', criado_por, nowISO(), nowISO()],
        function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID });
        });
});
app.put('/api/compras/:id', checkAdmin, (req, res) => {
    const { link, modelo, preco_fipe, tag, prazo_encerramento, proposta, notas, status } = req.body;
    db.run(`UPDATE compras SET link=?,modelo=?,preco_fipe=?,tag=?,prazo_encerramento=?,proposta=?,notas=?,status=?,atualizado_em=? WHERE id=?`,
        [link||null, modelo||null, preco_fipe||null, tag||'Esperando', prazo_encerramento||null, proposta||null, notas||null, status||'Avaliando', nowISO(), req.params.id],
        (err) => { if (err) return res.status(500).json({ erro: err.message }); res.json({ sucesso: true }); });
});
app.delete('/api/compras/:id', checkAdmin, (req, res) => {
    db.run(`DELETE FROM compras WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
});

// ============================================================
// CUSTOS RÁPIDOS
// ============================================================
app.get('/api/custos-rapidos', (req, res) => {
    const usuario = req.headers['x-username'];
    if (!usuario) return res.status(401).json({ erro: 'Não autenticado.' });
    // Admin vê todos; funcionário vê só os seus
    db.get(`SELECT cargo FROM usuarios WHERE username = ?`, [usuario], (err, u) => {
        const sql = (u && u.cargo === 'admin')
            ? `SELECT * FROM custos_rapidos ORDER BY data_hora DESC LIMIT 200`
            : `SELECT * FROM custos_rapidos WHERE usuario = ? ORDER BY data_hora DESC LIMIT 100`;
        const params = (u && u.cargo === 'admin') ? [] : [usuario];
        db.all(sql, params, (err, rows) => res.json(rows || []));
    });
});
app.post('/api/custos-rapidos', (req, res) => {
    const { descricao, valor, categoria, carro_ref } = req.body;
    const usuario = req.headers['x-username'] || 'desconhecido';
    if (!descricao || !valor) return res.status(400).json({ erro: 'Descrição e valor obrigatórios.' });
    db.run(`INSERT INTO custos_rapidos (descricao,valor,categoria,carro_ref,usuario,data_hora) VALUES (?,?,?,?,?,?)`,
        [descricao, parseFloat(valor), categoria||'Geral', carro_ref||null, usuario, nowISO()],
        function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID });
        });
});
app.delete('/api/custos-rapidos/:id', (req, res) => {
    db.run(`DELETE FROM custos_rapidos WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
});

// ============================================================
// TAREFAS (TO-DO)
// ============================================================
app.get('/api/tarefas', (req, res) => {
    const usuario = req.headers['x-username'];
    if (!usuario) return res.status(401).json({ erro: 'Não autenticado.' });
    db.all(`SELECT * FROM tarefas ORDER BY 
        CASE prioridade WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Normal' THEN 3 ELSE 4 END,
        criado_em DESC`, [], (err, rows) => res.json(rows || []));
});
app.post('/api/tarefas', (req, res) => {
    const { titulo, descricao, prioridade, atribuido_para, prazo } = req.body;
    const criado_por = req.headers['x-username'] || 'sistema';
    if (!titulo) return res.status(400).json({ erro: 'Título obrigatório.' });
    db.run(`INSERT INTO tarefas (titulo,descricao,prioridade,status,criado_por,atribuido_para,prazo,criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [titulo, descricao||null, prioridade||'Normal', 'Pendente', criado_por, atribuido_para||null, prazo||null, nowISO()],
        function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ id: this.lastID });
        });
});
app.put('/api/tarefas/:id', (req, res) => {
    const { titulo, descricao, prioridade, status, atribuido_para, prazo } = req.body;
    const concluido_em = status === 'Concluída' ? nowISO() : null;
    db.run(`UPDATE tarefas SET titulo=?,descricao=?,prioridade=?,status=?,atribuido_para=?,prazo=?,concluido_em=? WHERE id=?`,
        [titulo, descricao||null, prioridade||'Normal', status||'Pendente', atribuido_para||null, prazo||null, concluido_em, req.params.id],
        (err) => { if (err) return res.status(500).json({ erro: err.message }); res.json({ sucesso: true }); });
});
app.delete('/api/tarefas/:id', (req, res) => {
    db.run(`DELETE FROM tarefas WHERE id = ?`, [req.params.id], () => res.json({ sucesso: true }));
});

app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));
