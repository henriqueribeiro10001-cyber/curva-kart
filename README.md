# Curva Kart 🏁

Corrida de kart top-down para jogar com amigos: a corrida roda na tela grande
(notebook, PC, TV com navegador) e cada jogador usa o **celular como controle**,
conectado direto por P2P (WebRTC via [PeerJS](https://peerjs.com/)) — sem
backend, sem custo, sem servidor pra manter no ar.

## Como jogar

1. Abra `index.html` (a "tela da corrida") num computador ou notebook.
2. Um código de 4 letras aparece na tela, junto com um QR code.
3. Cada jogador abre `controller.html` no celular — ou escaneia o QR, ou digita
   o código manualmente — e vira um piloto.
4. Vagas que ninguém ocupar até o início da corrida são preenchidas por karts
   controlados pelo computador.
5. Quem está na tela grande clica em **Começar corrida**.
6. No celular: os botões ◀ ▶ viram o kart, ACELERAR mantém pressionado pra
   acelerar, e ITEM usa o item que você pegar na pista (turbo ou casca de
   banana).

3 voltas, 4 karts na pista, itens espalhados pelo circuito. Boa corrida!

## Publicar no GitHub + Vercel (de graça)

1. Crie um repositório novo no GitHub e suba esta pasta inteira
   (`index.html`, `controller.html`, `css/`, `js/`).
2. Em [vercel.com](https://vercel.com), clique em **Add New → Project** e
   importe esse repositório.
3. Não precisa configurar nada — é um site estático puro, sem build step.
   Deixe "Framework Preset" como **Other** e clique em Deploy.
4. Pronto: sua URL vai ser algo como `https://seu-projeto.vercel.app`.
   `index.html` é a tela principal e `controller.html` é o controle.

## Por que isso não custa nada

- **Vercel** hospeda o site estático (HTML/CSS/JS) de graça no plano free.
- **PeerJS** usa o servidor público de sinalização deles (`0.peerjs.com`)
  só para os dois aparelhos se "apresentarem" um pro outro — depois disso a
  conexão é direta entre os celulares/computador (WebRTC), sem passar mais
  pelo servidor. Também é gratuito, sem cadastro.
- Não existe nenhum banco de dados, servidor de jogo ou conta paga em lugar
  nenhum dessa stack.

**Único ponto de atenção**: por ser um serviço público e compartilhado, o
broker do PeerJS eventualmente pode ficar instável ou lento (é raro). Para
uma partida entre amigos isso praticamente nunca é um problema — se quiser
mais controle no futuro, dá pra rodar seu próprio servidor PeerJS (também
gratuito) em serviços como Render.

## Estrutura dos arquivos

```
index.html          → tela principal (a "TV"), roda toda a simulação
controller.html      → tela do controle no celular
css/style.css        → estilo compartilhado das duas telas
js/track.js          → geometria da pista e cálculo de volta/progresso
js/kart.js           → física do kart, itens e colisões
js/host.js           → lobby, loop do jogo, renderização, placar
js/controller.js      → conexão PeerJS do celular e captura dos toques
```

## Limitações conhecidas

- Pensado para até 4 pilotos por sala; o restante vira CPU.
- Cada aba/celular puxa uma sala nova — não dá pra ter duas telas "TV" na
  mesma sala.
- Precisa que os dois lados tenham internet (o pareamento inicial depende do
  broker do PeerJS), mas depois de conectado o jogo em si não depende de uma
  rede local específica.
