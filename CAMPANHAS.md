# Campanhas no Daggery

## Testar localmente

Com Node.js 22.12 ou superior e dependências instaladas, inicie o aplicativo na raiz do projeto:

```bash
npm run dev
```

Abra http://localhost:5173 e entre por e-mail, após configurar SMTP conforme abaixo, ou use a opção de senha existente. Crie uma campanha. O mestre pode gerar um convite de uso único; a outra pessoa precisa ter uma conta e inserir o código na lista de campanhas. Anotações privadas são restritas ao autor; as compartilhadas são editáveis pelos membros.

## Mestre de IA

Para jogar com um mestre de IA, selecione **AI Game Master** na criação ou nas
configurações da campanha. Em **Adventure**, conecte sua chave da API do OpenCode
Console, escolha um modelo, prepare o herói e clique em **Begin the adventure** para abrir a sessão. Criar uma sessão não inicia o mestre. Se o diário já tiver entradas, o mestre começa com um resumo da história.
Consulte [configuração do mestre de IA](docs/ai-gm.md) para detalhes e backups da chave.

## Sessões, diário e memória do mestre

Uma campanha com mestre de IA pode ter várias sessões, cada uma com sua própria conversa. Só o dono da campanha, que controla o mestre de IA, cria, renomeia, encerra, compacta e apaga sessões. Os membros veem todas as sessões e podem jogar nas que estiverem abertas. Ao encerrar uma sessão, o mestre escreve um capítulo final com o que ainda não foi resumido, e a sessão passa a ser somente leitura. Apagar uma sessão remove as mensagens dela, mas as entradas do diário continuam e mantêm o nome da sessão.

O diário é o registro da campanha e é compartilhado por todas as sessões. Ele tem três tipos de entrada. Os eventos são registrados automaticamente, a partir de rolagens, mudanças de cena, dano, Fear, contadores, recompensas, ataques, condições e escolhas; eles não podem ser editados. As anotações são escritas pelo mestre ou pelo dono e ficam visíveis só para o dono, a menos que sejam marcadas como compartilhadas. Os capítulos são escritos quando a conversa de uma sessão é compactada e quando a sessão termina; eles são sempre compartilhados. O dono pode editar e apagar anotações e capítulos. Os membros veem apenas as entradas compartilhadas.

A memória do mestre de IA reúne um resumo da campanha, os capítulos mais recentes (três nos tamanhos Lean, Balanced e Rich, e doze no Maximum), os segredos e planos do mestre, o estado da campanha (local, hora do dia, objetivo, tramas, NPCs, promessas ligadas aos jogadores e fatos) e um resumo da sessão atual. Os jogadores veem a conversa da sessão e as entradas compartilhadas do diário. O resumo da campanha, os segredos, o estado e o resumo da sessão ficam visíveis só para o dono. Quando a conversa fica longa, o mestre compacta as mensagens mais antigas em um capítulo e mantém as mais recentes completas. Esses resumos são escritos pelo modelo de IA e podem omitir ou errar detalhes. O tamanho da memória (Lean, Balanced, Rich ou Maximum) é escolhido na configuração da aventura. O tamanho Maximum usa até 60% da janela de contexto do modelo, cerca de 600 mil tokens em um modelo de 1 milhão de tokens; cada pedido fica muito maior, custa mais e pode demorar mais. Detalhes e limites estão em [configuração do mestre de IA](docs/ai-gm.md).

## Login por e-mail

O envio real exige uma conta SMTP configurada no ambiente do processo do servidor. Defina `DAGGERY_SMTP_HOST`, `DAGGERY_SMTP_PORT` (465 para TLS direto, ou outra porta como 587 para STARTTLS obrigatório), `DAGGERY_SMTP_USER`, `DAGGERY_SMTP_PASSWORD` e `DAGGERY_SMTP_FROM` (remetente autorizado pelo provedor); reinicie o servidor após alterar as variáveis. Use credenciais próprias do provedor ou senha de aplicativo, nunca as salve no repositório. Sem configuração, o botão informa que o envio está indisponível; nenhum código de login é impresso no console.

O código tem oito dígitos, expira em 10 minutos e só funciona uma vez; há limite de tentativas e intervalo entre envios. Um endereço ainda não cadastrado cria uma conta após verificação apenas quando o registro estiver habilitado. Para usar e-mail com uma conta antiga e manter suas campanhas, entre primeiro com usuário e senha e use **Vincular e-mail à conta** na tela de campanhas; confirme o código antes de sair. Não é feito vínculo automático pelo nome. Códigos pendentes deixam de funcionar após reinício do servidor.


## Limitações desta versão

- **Não publique na internet ainda.** A autorização e os fluxos para multiplayer, publicação, recuperação e arquivos não estão completos nem foram submetidos a uma revisão de segurança abrangente.
- Jogadores ainda não recebem o mapa: o bloqueio evita expor áreas sob névoa e tokens ocultos. Arquivos enviados à biblioteca só ficam disponíveis para o mestre. A exclusão e o compartilhamento de arquivos ainda não estão disponíveis.
- Fichas são compartilhadas entre membros da campanha. A sincronização usa última gravação e não oferece edição offline ou resolução de conflitos.
- A campanha antiga é mantida separada, sem dono. Arquivos anteriores em `/assets/` ainda não foram convertidos para os novos endereços protegidos; imagens antigas podem não aparecer. Os arquivos originais não são apagados.

## Dados e campanha anterior

Os dados ficam em `data/daggery.db` e os novos arquivos em `data/campaign-assets`, salvo configuração diferente. A migração faz backup SQLite consistente e copia arquivos legados em `data/backups` antes de alterar um banco anterior. Preserve também `data/assets`, `data/cards` e os backups. Para um backup manual completo, pare o servidor antes de copiar a pasta `data` inteira; não copie apenas o arquivo `.db` enquanto o servidor estiver ativo, pois pode haver dados no WAL.

Para associar manualmente a campanha anterior a uma conta já criada, execute **no computador que controla o banco**, após iniciar ao menos uma vez o servidor para migrar o banco e verificar o backup:

```bash
npm run claim-legacy -w @daggery/server -- NOME_DA_CONTA
```

Esse comando não disponibiliza imagens antigas nem deve ser executado até você decidir qual conta será dona da campanha. A associação é única e não ocorre automaticamente para visitantes.

## Configuração

`DAGGERY_DATA_DIR` altera a pasta persistente; `DAGGERY_DB` altera apenas o caminho do banco. `HOST`, `PORT` e `DAGGERY_SERVER_PORT` controlam o servidor; em desenvolvimento o servidor aceita somente loopback. `DAGGERY_ORIGIN` define a origem exata autorizada para HTTP e WebSocket. `DAGGERY_ALLOW_REGISTRATION=0` desativa novos registros. O backend exige HTTPS e cookies seguros em modo de produção, mas isso por si só não torna esta versão pronta para implantação pública.
