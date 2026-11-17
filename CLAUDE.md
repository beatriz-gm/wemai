# WEMAI — Diretrizes de desenvolvimento

## Escopo atual
Estamos desenvolvendo e refinando exclusivamente a experiência mobile. Não implementar ou modificar a versão desktop sem solicitação.

## Identidade
Preservar os SVGs oficiais, a geometria do arco e a identidade visual da WEMAI.

A abertura utiliza a logo completa. A navbar compacta utiliza a variante sem a assinatura.

## Animação de abertura
Preservar a possibilidade de alternar entre as versões Classic e Tech.

Não modificar a geometria, o movimento da câmera, a duração ou a composição da Home quando a tarefa solicitar apenas mudanças de materiais, iluminação ou elementos visuais.

## Fluxo de trabalho
Realizar uma alteração visual por tarefa.

Antes de modificar, identificar o componente responsável pelo comportamento solicitado.

Preferir mudanças localizadas e reversíveis. Não refatorar componentes sem necessidade diretamente relacionada à tarefa.

Quando uma solicitação for de análise, não editar código.

## Validação
Após implementar, verificar a cena mobile afetada pela alteração.

Quando possível, comparar capturas antes e depois no mesmo instante da animação.

Se não for possível inspecionar visualmente o resultado, informar essa limitação.

Preservar os avanços aprovados em refinamentos anteriores.

## Notas técnicas
- Cada teste visual fica em uma branch própria, criada a partir da anterior, para comparação. Nunca enviar ao `main` sem aprovação explícita.
- Arquivos com quebra de linha CRLF: editar sem converter para LF (não usar `sed -i` do Git Bash).
- O túnel da abertura é um shader WebGL em `js/intro-tunnel.js`; a linha do tempo fica em `js/intro.js`. Ajustes só do mobile entram por uniforms ligados com `COARSE` (pointer: coarse), que ficam em 0 no desktop.
- O caminho do SVG do logo nunca é alterado; apenas transformações.
- A visualização local é pelo Live Server: http://127.0.0.1:5500/index.html (mostra a branch atual).
