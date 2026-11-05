# Central de Notebooks — integração segura em preparação

Links preservados:

- Docentes: `https://notebooks-tau.vercel.app/` (sem login).
- Supervisão: `https://notebooks-tau.vercel.app/?painel=supervisao` (login individual).

## Estado e ativação

Esta alteração deve ficar em branch/preview até a infraestrutura ser validada.
O Firebase CLI desta máquina não estava autenticado na inspeção; a edição,
localização, usuários e credenciais do banco existente ainda não foram
verificados. A Vercel não possuía variáveis de ambiente. Não houve migração nem
publicação em produção. Os dados dos navegadores continuam sendo a fonte para
recuperar reservas anteriores à integração.

1. Autenticar no Firebase CLI com uma conta autorizada (não enviar senhas,
   tokens ou chaves privadas pelo chat). Executar:
   `firebase firestore:databases:list --project central-notebooks-senac` e
   `firebase firestore:databases:get '(default)' --project central-notebooks-senac`.
   Confirmar banco, edição e região. Este código exige STANDARD; se o projeto
   usar Enterprise, revisar o acesso antes de ativar. Não criar outro banco.
2. Confirmar as regras atuais deny-all. O arquivo versionado mantém esse
   comportamento: nenhuma leitura/gravação direta do navegador, mesmo com
   claim de supervisor. Revisar IAM do serviço usado pelo Admin SDK, pois ele
   ignora as regras; conceder somente os acessos necessários a Firestore,
   verificação de App Check e consulta de usuários para revogação.
3. Configurar uma identidade de servidor no projeto existente. Preferir
   Application Default Credentials via federação de identidade; como alternativa,
   cadastrar `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` como segredos da
   Vercel. Nunca usar prefixo `VITE_` nesses segredos nem colocá-los em arquivos
   públicos. O código valida o projectId fixo.
4. Habilitar e-mail/senha no Firebase Authentication; criar contas individuais
   pela administração. Autorizar cada **UID** em `SUPERVISOR_UIDS` (servidor)
   ou definir claim `supervisor: true` com ferramenta administrativa confiável.
   Nenhum cadastro público de supervisores e nenhum privilégio por querystring.
   Não é necessário fornecer e-mails ao desenvolvedor para implementar o código.
   Contas sem autorização permanecem bloqueadas. Revogar/remover acessos no
   Firebase e na allowlist quando necessário.
5. Registrar o app Web no App Check com reCAPTCHA Enterprise, conferir domínio,
   provedor, cotas e `FIREBASE_APP_ID`. Definir `VITE_APP_CHECK_SITE_KEY` e a
   `VITE_FIREBASE_API_KEY` recuperada da captura (confirmar a transcrição com a
   configuração do console antes de publicar). A apiKey Web é pública e não
   substitui autenticação, regras ou App Check.
6. Preencher as variáveis de `.env.example` diretamente nos ambientes corretos
   da Vercel. `ALLOWED_ORIGINS` deve conter somente as origens exatas autorizadas
   (preview incluído quando for testar). `RATE_LIMIT_SECRET` deve ser um segredo
   aleatório forte, exclusivo do servidor. Habilitar TTL em
   `notebookRateLimits.expiresAt` para limpeza dos contadores.
7. Apenas após revisão de edição/IAM/regras, definir
   `FIREBASE_DATABASE_EDITION=STANDARD` e `INTEGRATION_ENABLED=true` no preview.
   Vite incorpora `VITE_` durante build: reconstruir ao alterar essas variáveis.
   Não misturar os segredos de produção com previews não revisados.
8. Verificar o preview com duas sessões/dispositivos: reserva futura concorrente,
   edição/cancelamento, bloqueio, login inválido/revogado, importação repetida e
   reconexão. Testar também o ingresso Vercel (`x-vercel-forwarded-for` confiável),
   App Check real e limite compartilhado. Essas verificações reais não são
   substituídas pelos testes locais. Somente depois publicar e verificar o mesmo
   fluxo nos links de produção.

## Arquitetura e limites

O front mantém o rack de 17 notebooks (20–36), formulários, seleção por período,
edição/cancelamento e consulta de histórico. Todas as gravações passam por
`/api/notebooks`, com validação de schema, datas reais, horários de meia hora,
início futuro, números permitidos, App Check e limite transacional por IP.
Não há modo de gravação local como fallback em falhas de rede.

Coleções privadas:

- `notebookReservations`: reservas e cancelamentos preservados como tombstones.
- `notebookMeta/state`: bloqueios e revisão; toda mutação disputa esse documento
  na mesma transação, serializando inclusive consultas sem conflitos prévios.
- `notebookAudit`: ação, horário de Brasília e UID administrativo quando houver.
  A função anterior de excluir histórico agora arquiva logicamente.
- `notebookRequests`: recibos duráveis que tornam retentativas idempotentes.
- `notebookImports`: hashes de reservas locais normalizadas, sem depender do ID
  de cada computador; cancelamentos não são ressuscitados pela reimportação.
- `notebookRateLimits`: contadores compartilhados com expiração para TTL.

O servidor envia revisões via SSE a partir de `onSnapshot` do Firestore. O cliente
renova a conexão a cada 45 segundos com App Check atualizado, refaz a consulta e
reconecta com espera progressiva. Nenhum token é colocado na URL. A leitura de
reservas e auditoria ocorre em transação de leitura consistente. Consultas cobrem
até 90 dias; selecionar uma janela menor para históricos distantes. Auditoria só
é retornada a supervisores; dados de contas e credenciais nunca são expostos.
Os dados de agendamento (docente, sala, turma, horários e equipamentos) continuam
visíveis aos docentes para a coleta, como no produto anterior. App Check reduz
abuso, mas não comprova a identidade de um docente sem login.

Há limite inicial de 20 gravações e 180 leituras/conexões por minuto por IP;
computadores da escola podem compartilhar IP. Ajustar após testar o uso real,
considerando cotas/custos de Firestore e SSE. O documento global de revisão
prioriza integridade para este rack pequeno; alto volume exige revisão de
contenção. Uma janela com grande histórico também exige paginação futura. O
arquivamento de auditoria limita cada operação a 350 eventos; nunca apaga reservas.

## Importação local: preservar, revisar, confirmar

Nada grava nem remove `senac-central-notebooks-v1`. Na inicialização os dados
antigos são lidos para consulta até a conexão; ao conectar, a visão compartilhada
é exibida. O original continua disponível para exportar/importar.

Em **cada navegador/perfil/computador** que tenha reservas antigas:

1. Exportar o JSON pelo botão e guardar uma cópia. O backup inclui reservas,
   bloqueios e auditoria originais, sem alterações.
2. Entrar na Supervisão nesse mesmo navegador e clicar em **Revisar e importar**.
3. Conferir a lista e confirmar. Cada reserva é validada e importada em transação;
   duplicatas são ignoradas, conflitos/erros são listados e podem ser resolvidos
   sem perda do original. Importações parciais podem ser repetidas com segurança.
4. Verificar no segundo dispositivo. Para Hugo, conferir 05/11/2026,
   13:00–17:30, sala 206, turma Aprendizagem, notebooks 21–25. A captura é
   evidência visual: não foi usada para fabricar uma reserva no banco.

Bloqueios e auditoria antigos são preservados no backup, mas **não são aplicados
automaticamente ao servidor**: bloqueios locais podem estar desatualizados e a
auditoria é conteúdo não verificado. Revisar os bloqueios na Supervisão e
conservar o arquivo original como histórico. Não limpar cache/dados do navegador.

## Desenvolvimento e validação

Node 22+ (produção existente usa 24): `npm ci`, `npm test`, `npm run build`.
`npm run dev` inicia somente o front. APIs reais exigem Vercel; um front sem
configuração mostra estado pendente e não aceita novas reservas.

Regras/concorrência no emulador, com Java 21+ e Firebase CLI:

```sh
firebase emulators:exec --only firestore --project demo-notebooks-tests "npm run test:emulator"
```

Os testes usam projeto `demo-`, negam execução sem emulador e não escrevem em
produção. Cobrem leituras, queries, gravações e subcoleções negadas para todos
os clientes, concorrência de reservas, idempotência, limites administrativos e
importação após cancelamento. O override de `@grpc/grpc-js` mantém a versão
corrigida e é verificado por testes/auditoria de dependências.

Referências: [transações](https://firebase.google.com/docs/firestore/manage-data/transactions),
[App Check no backend](https://firebase.google.com/docs/app-check/custom-resource-backend),
[Admin SDK](https://firebase.google.com/docs/admin/setup),
[Functions Node.js](https://vercel.com/docs/functions/runtimes/node-js).
