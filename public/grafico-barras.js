// Gráfico de barras em SVG (produção e vendas): lê os dados de #dados-grafico e desenha em #grafico,
// na largura real da tela; toque/hover e foco por teclado mostram o valor.
(function () {
  const el = document.getElementById('grafico');
  if (!el) return;
  // prefixo: ex. "R$ " no número do maior valor (o eixo fica só com números)
  const { baldes, escala, maior, prefixo = '' } = JSON.parse(document.getElementById('dados-grafico').textContent);
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const no = (tag, attrs, pai) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (pai) pai.appendChild(n);
    return n;
  };

  // Tooltip único (HTML, conteúdo via textContent)
  const dica = document.createElement('div');
  dica.className = 'grafico-dica';
  dica.hidden = true;
  const dicaValor = document.createElement('strong');
  const dicaRotulo = document.createElement('span');
  dica.append(dicaValor, dicaRotulo);

  function desenhar() {
    el.replaceChildren();
    const W = el.clientWidth;
    const H = 240;
    const m = { esq: 40, dir: 8, topo: 22, base: 26 };
    const pw = W - m.esq - m.dir;
    const ph = H - m.topo - m.base;
    const y = (v) => m.topo + ph - (v / escala.topo) * ph;
    const svg = no('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, el);

    // Grade e eixo Y (linhas finas, discretas)
    for (let v = 0; v <= escala.topo + 1e-9; v += escala.passo) {
      no('line', { x1: m.esq, x2: W - m.dir, y1: y(v), y2: y(v), class: 'grade' }, svg);
      const t = no('text', { x: m.esq - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'eixo' }, svg);
      // Número completo até 9.999 (ex.: 1.250); abrevia só daí em diante, sem perder precisão
      t.textContent = v >= 10000 ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v / 1000) + ' mil' : fmt.format(v);
    }

    const banda = pw / baldes.length;
    const largura = Math.max(2, Math.min(24, banda - 2)); // no máximo 24px, com 2px de respiro
    const cadaRotulo = Math.ceil(baldes.length / Math.max(1, Math.floor(pw / 52)));

    baldes.forEach((b, i) => {
      const cx = m.esq + banda * i + banda / 2;
      const x = cx - largura / 2;
      const topo = y(b.valor);
      const base = y(0);
      const g = no('g', { class: 'barra', tabindex: 0, role: 'img' }, svg);
      g.setAttribute('aria-label', `${b.detalhe}: ${b.texto}`);
      // Área de toque: a coluna inteira, maior que a barra
      no('rect', { x: m.esq + banda * i, y: m.topo, width: banda, height: ph, class: 'alvo' }, g);
      if (b.valor > 0) {
        const r = Math.min(4, (base - topo) / 2, largura / 2); // ponta arredondada, base reta
        no('path', {
          class: 'marca',
          d: `M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + largura - r} Q${x + largura},${topo} ${x + largura},${topo + r} V${base} Z`,
        }, g);
      }
      // Rótulo seletivo: só o maior valor recebe número em cima
      if (b.inicio === maior) {
        const t = no('text', { x: cx, y: topo - 6, 'text-anchor': 'middle', class: 'rotulo-valor' }, svg);
        t.textContent = prefixo + fmt.format(b.valor);
      }
      const ultimo = i === baldes.length - 1;
      if ((baldes.length - 1 - i) % cadaRotulo === 0 || ultimo) {
        const t = no('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'eixo' }, svg);
        t.textContent = b.rotulo;
      }

      const mostrar = () => {
        dicaValor.textContent = b.texto;
        dicaRotulo.textContent = b.detalhe;
        dica.hidden = false;
        const larguraDica = dica.offsetWidth;
        dica.style.left = Math.min(Math.max(0, cx - larguraDica / 2), W - larguraDica) + 'px';
        dica.style.top = Math.max(0, topo - dica.offsetHeight - 8) + 'px';
        g.classList.add('ativa');
      };
      const esconder = () => { dica.hidden = true; g.classList.remove('ativa'); };
      g.addEventListener('pointerenter', mostrar);
      g.addEventListener('pointerdown', mostrar);
      g.addEventListener('focus', mostrar);
      g.addEventListener('pointerleave', esconder);
      g.addEventListener('blur', esconder);
    });
    el.appendChild(dica);
  }

  desenhar();
  let espera;
  window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(desenhar, 150); });
})();
