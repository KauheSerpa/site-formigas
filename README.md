# Formigueiro Analytics

App (Node.js + Express + SQLite) para catalogar formigueiros por foto, medir
seu tamanho diretamente na imagem (calibrando a escala com um objeto de referência)
e acompanhar crescimento, comparações e escalonamento alométrico ao longo do tempo.

## Rodando localmente

```bash
npm install
npm start
```

Abra http://localhost:3000

## Como usar

1. Na aba **Registrar**, crie um formigueiro (nome, espécie, local).
2. Selecione-o e envie uma foto do monte.
3. **Calibre a escala**: clique 2 pontos sobre um objeto de tamanho conhecido na
   foto (moeda, régua, tijolo) e informe o comprimento real em cm.
4. **Meça o diâmetro**: clique 2 pontos nas bordas opostas do monte.
5. (Opcional) **Meça a área**: clique o contorno do monte e feche o polígono.
6. Preencha altura estimada, nº de formigas visíveis, nº de entradas e data —
   tudo opcional, mas alimenta os gráficos de escalonamento.
7. Salve. Repita ao longo do tempo para acompanhar o crescimento.
8. Veja a aba **Dashboard** para gráficos de evolução, comparação entre
   formigueiros, histograma de tamanhos, taxa de crescimento e escalonamento
   (área × população, diâmetro × volume estimado).

## Deploy no Render.com

O repositório já inclui um `render.yaml` pronto (Blueprint).

1. Faça login em https://render.com (pode usar sua conta do GitHub).
2. No dashboard, clique **New +** → **Blueprint**.
3. Conecte o repositório `KauheSerpa/site-formigas`. O Render vai ler o
   `render.yaml` automaticamente e propor o serviço `site-formigas`
   (Node, plano Free, `npm install` / `npm start`).
4. Clique **Apply** / **Create**. O primeiro build leva alguns minutos
   (compila o `better-sqlite3`, que é um módulo nativo).
5. Quando terminar, o Render te dá uma URL pública, algo como
   `https://site-formigas.onrender.com`.

Alternativa sem Blueprint: **New +** → **Web Service**, conecte o repo,
Build Command `npm install`, Start Command `npm start`, plano Free.

### Sobre persistência de dados (importante)

No plano **Free** do Render o disco é efêmero: as fotos enviadas e o banco
SQLite podem ser apagados sempre que o serviço reinicia ou é reimplantado.
Ótimo para colocar o site no ar rapidamente e testar, mas não garante que
seus dados fiquem salvos para sempre.

Para persistência de verdade:
1. Faça upgrade do serviço para o plano **Starter** (pago) no dashboard do Render.
2. Adicione um **Disk** (aba *Disks*) montado em `/var/data`, com o tamanho
   que preferir (1 GB já é bastante para começar).
3. Defina a variável de ambiente `DATA_DIR=/var/data` no serviço.
4. Faça um novo deploy. O servidor já está preparado para usar `DATA_DIR`
   quando ela existir (veja `server.js`); sem ela, usa as pastas locais do
   projeto normalmente.

Também vale notar que o plano Free do Render "dorme" após ~15 min sem uso —
o primeiro acesso depois disso demora um pouco (cold start) até o serviço
acordar.

## Dados

Localmente: imagens em `uploads/`, banco SQLite em `data/formigueiros.db`.
Em produção, use as pastas equivalentes dentro de `DATA_DIR` (ver acima).
