# Central de Notebooks Senac

Dois links, sem formulário de login. Docentes usam a página pública. O endereço
administrativo contém uma capacidade secreta de 256 bits no fragmento #acesso=.
Quem possui o link administrativo pode administrar; compartilhe apenas com a
Supervisão. O link completo permanece no endereço e funciona em qualquer
computador/navegador, mesmo sem cookies. Cada chamada administrativa transmite
a capacidade somente no cabeçalho X-Notebooks-Admin-Link da API na mesma origem;
o servidor compara seu SHA-256 em tempo constante. Não há login nem cadastro.
O fragmento não é enviado em URLs HTTP ou referrers. Copiar somente a parte
anterior ao # remove a autorização. Cookies assinados antigos são aceitos apenas
por compatibilidade; o link completo não depende deles nem de localStorage.
Sair da Supervisão remove a capacidade da página atual, sem revogar o link.
Rotação do hash revoga os links em todos os dispositivos.

## Segurança e sincronização

Firestore Admin SDK somente no servidor, regras do cliente deny-all mantidas.
O servidor confirma tipo, edição e região do banco existente antes de escrever.
Reservas, bloqueios, edições, cancelamentos e importações são validados no servidor.
Todas as mutações disputam a revisão global na mesma transação, impedindo reservas
concorrentes conflitantes. Leituras são consistentes. SSE/onSnapshot comunica
revisões entre dispositivos, com reconexão automática. Rack preservado: 20–36.

API impõe origem exata, JSON e tamanho limitados, schemas, datas, números, início
futuro e contador compartilhado por IP: 30 gravações e 240 leituras por minuto.
Não existe autorização por querystring. App Check é opcional, desligado nesta
versão para evitar o cadastro adicional de reCAPTCHA. O fluxo sem login não
comprova identidade dos docentes; limite/origem reduzem abuso, mas origem não
substitui identidade e pode ser simulada por clientes externos. Ajustar cotas após
observar a escola, onde vários computadores podem compartilhar o mesmo IP.
Nunca habilitar APP_CHECK_REQUIRED sem também integrar e testar seu provedor no
cliente. O link administrativo não é incluído no código ou em respostas públicas.

## Dados antigos

Nada grava nem remove senac-central-notebooks-v1. Dados locais são lidos para
consulta até a conexão e permanecem disponíveis para backup e migração.
Em cada computador/perfil, exportar uma cópia e abrir o link administrativo para
revisar e confirmar a importação. Reservas são importadas individualmente, com
hashes estáveis e recibos duráveis: duplicatas são ignoradas, conflitos reportados
e cancelamentos não são ressuscitados. Bloqueios/auditoria antigos permanecem no
backup e precisam de revisão manual antes de aplicar ao servidor.

A reserva do Hugo confirmada pelo usuário: 05/11/2026, 13:00–17:30, sala 206,
turma Aprendizagem, notebooks 21–25. Importação autorizada explicitamente no chat;
verificar no banco e nos dois painéis antes de concluir a publicação.

Cancelamentos preservam tombstones; arquivamento de auditoria é lógico. A
auditoria de administração identifica admin-link, sem atribuição a pessoa, pois
o acesso é compartilhado. As coleções notebookReservations, notebookAudit,
notebookMeta, notebookRequests, notebookImports e notebookRateLimits são privadas.
Habilitar TTL em notebookRateLimits.expiresAt para limpar contadores vencidos.

## Configuração

Na Vercel, segredos FIREBASE_PRIVATE_KEY, ADMIN_LINK_HASH, ADMIN_SESSION_SECRET e
RATE_LIMIT_SECRET nunca usam prefixo VITE_ nem entram no GitHub. Conta de serviço
dedicada notebooks-vercel com Cloud Datastore User. Firebase Authentication e
papel de leitura de seus usuários não são necessários neste fluxo sem login.
FIREBASE_CLIENT_EMAIL identifica essa conta. FIREBASE_PROJECT_ID fixo em
central-notebooks-senac; banco nomeado default (sem parênteses), Enterprise Native,
southamerica-east1, com REALTIME_UPDATES_MODE_ENABLED, confirmado pela API do
Google Cloud. Core operations são usadas para leituras em transação coordenadas
com o listener realtime, requisito absoluto de sincronização e integridade deste
fluxo. INTEGRATION_ENABLED=true somente após
revisar o build. ALLOWED_ORIGINS contém as origens exatas de produção e teste.

Rotacionar ADMIN_LINK_HASH e ADMIN_SESSION_SECRET revoga o link/sessões antigas.
Gerar novo token aleatório criptográfico, armazenar somente seu SHA-256 como
ADMIN_LINK_HASH e entregar o token no fragmento do link apenas ao administrador.
Backup privado da capacidade deve ficar fora do repositório. Nunca publicar
chaves privadas ou links administrativos em issues, PRs ou documentação pública.

## Testes e implantação

Node 24, npm ci, npm test, npm run build. CI executa também o emulador Firestore
com Java 21 e projeto demo-notebooks-tests. Testes verificam regras deny-all,
concorrência, retentativas, importação, conflitos, autorização administrativa,
cookie alterado/expirado e revogação por rotação de link.

Testar preview primeiro e depois publicar o mesmo código em produção. Variáveis
de credencial foram movidas para produção, sem ler valores, após o teste do
preview. Novos previews não recebem as credenciais de produção.
Conferir o 403 em operações administrativas sem cookie, histórico público sem
auditoria, a reserva do Hugo e atualização entre dois clientes. Main e produção
devem refletir o commit testado; não promover builds antigos com login individual.

Limites: janela de consulta de até 90 dias; revisão global prioriza integridade
para este rack pequeno. Alto volume exige rever contenção/paginação. Auditoria
de até 350 eventos por operação de arquivamento; nenhum dado é truncado.
Firebase Admin 13.10.0 evita incompatibilidade ESM do carregador Vercel; overrides
de grpc-js e uuid mantêm dependências corrigidas e verificadas por npm audit.

Validação real em 05/11/2026: Hugo importado com recibo idempotente; duas leituras
independentes confirmaram 21–25 às 13:00–17:30. SSE entregou evento após gravação.
Operação administrativa pública retornou 403, reserva conflitante retornou 409 e
segunda importação foi ignorada. Interface docente mostrou o registro do Hugo.

Correções administrativas: formulários abertos não são sobrescritos pela atualização realtime/relógio. Correções de reservas já iniciadas mantêm o início original; reagendar para outro início continua exigindo horário futuro. Cancelamento preserva histórico.
