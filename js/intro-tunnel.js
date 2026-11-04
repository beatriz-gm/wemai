/* ==========================================================================
   WEMAI — Abertura: o túnel em 3D (WebGL)

   A arquitetura é calculada por pixel, com geometria analítica (ray casting
   num único shader de tela cheia): cada pixel lança um raio a partir da
   câmera e encontra a superfície real que está à frente dele. Assim, piso,
   paredes, abóbada, parede do fundo e fachada têm perspectiva exata, e a luz
   depende da posição e da orientação de cada superfície.

   Espaço (unidades da logo; y para baixo, como no SVG)
     x: centrado no eixo do arco (ARC_X)       y: altura         z: distância à
     frente da parede do fundo (z = 0). A câmera fica em (0, eye, camera).

   Estrutura
     - fachada (z = length): plano com a abertura do túnel (fica atrás da câmera
       quando o túnel é mais longo que a distância inicial);
     - túnel: paredes verticais (x = ±halfWidth) sob uma abóbada (semielipse
       com semieixos halfWidth × vaultRise, nascendo em y = spring);
     - piso (y = floor): contínuo, dentro e fora do túnel;
     - parede do fundo (z = 0) com o vão: o círculo interno do arco da logo e,
       da sua largura máxima, ombreiras verticais até o piso — o vão tem a
       largura do arco em toda a altura. O vão tem espessura (reveal); depois
       dele, transparência: a paisagem (HTML) aparece por trás do canvas.

   Este arquivo só desenha. O tempo e a câmera ficam em js/intro.js.
   ========================================================================== */

(function () {
  'use strict';

  var VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  // Constantes da cena, injetadas no shader (mesma geometria usada pelo SVG da logo).
  function fragmentSource(g) {
    function f(v) { return (+v).toFixed(3); }
    return [
      'precision highp float;',
      'uniform vec2 uView;uniform float uDpr,uVpY,uF,uCam,uW,uV,uSunX;',
      'uniform float uMat,uArch,uCol,uLight,uStrip,uJoint,uAlpha;',
      '#define EYE ' + f(g.eye),
      '#define FLOOR ' + f(g.floor),
      '#define SPRING ' + f(g.spring),
      '#define LEN ' + f(g.length),
      '#define REVEAL ' + f(g.reveal),
      '#define ARC_CY ' + f(g.arcCenterY),
      '#define ARC_R ' + f(g.outerR),
      '#define IN_CY ' + f(g.innerCenterY),
      '#define IN_R ' + f(g.innerR),
      '#define JAMB_X ' + f(g.jambX),
      '#define JAMB_Y ' + f(g.jambY),
      SHADER_BODY
    ].join('\n');
  }

  var SHADER_BODY = [
    // Paleta: pedra clara e quente; luz da paisagem; frisos.
    'const vec3 STONE=vec3(.905,.874,.836);',
    'const vec3 VAULT=vec3(.872,.862,.852);',
    'const vec3 FLOORC=vec3(.915,.888,.852);',
    'const vec3 AMB=vec3(.86,.875,.905);',
    'const vec3 WARM=vec3(1.,.86,.70);',
    'const vec3 SKY=vec3(.62,.72,.86);',
    'const vec3 STRIP=vec3(1.,.87,.70);',

    // Linha fina com antialiasing analítico: d = distância à linha, fp = tamanho do pixel.
    'float line(float d,float hw,float fp){float w=max(hw,fp*.5);return (hw/w)*(1.-smoothstep(w,w+fp,abs(d)));}',
    'float grid(float c,float s,float off,float hw,float fp){float q=c-off;return line(q-s*floor(q/s+.5),hw,fp);}',

    // Distância (aprox.) até a borda do vão; negativa dentro.
    'float portalSd(vec2 q){',
    '  if(q.y<JAMB_Y) return length(vec2(q.x,q.y-IN_CY))-IN_R;',
    '  return max(abs(q.x)-JAMB_X,q.y-FLOOR);',
    '}',

    // Saída do raio (no plano xy, a partir do olho) por um perfil "retângulo + arco".
    // kind: 0 piso, 1 parede/ombreira, 2 abóbada/arco. Retorna t.
    'float exitProfile(vec2 d,float hw,float top,float rx,float ry,float cy,out float kind){',
    '  float tf=d.y>0.?(FLOOR-EYE)/d.y:1e9;',
    '  float tw=abs(d.x)>1e-6?hw/abs(d.x):1e9;',
    '  if(tf<=tw){kind=0.;return tf;}',
    '  if(EYE+tw*d.y>=top){kind=1.;return tw;}',
    '  vec2 s=vec2(d.x/rx,d.y/ry);float o=(EYE-cy)/ry;',
    '  float a=dot(s,s),b=2.*o*s.y,c=o*o-1.;',
    '  kind=2.;return (-b+sqrt(max(b*b-4.*a*c,0.)))/(2.*a);',
    '}',

    'void main(){',
    '  vec2 px=vec2(gl_FragCoord.x,uView.y*uDpr-gl_FragCoord.y)/uDpr;',
    '  vec2 d=vec2((px.x-uView.x*.5)/uF,(px.y-uVpY)/uF);',
    '  float kind;',
    '  float tT=exitProfile(d,uW,SPRING,uW,uV,SPRING,kind);',
    '  float tFac=uCam-LEN;',
    '  float t;vec3 N;float surf;',       // surf: 0 piso 1 parede 2 abóbada 3 fundo 4 fachada 5 ombreira 6 arco 7 aberto
    '  float tFl=d.y>0.?(FLOOR-EYE)/d.y:1e9;',
    '  if(tFac>0.&&tT<tFac){',
    '    if(tFl<tFac){t=tFl;surf=0.;}else{t=tFac;surf=4.;}',
    '  }else if(tT<=uCam){',
    '    t=tT;surf=kind;',
    '  }else{',
    '    vec2 q=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    if(portalSd(q)>0.){t=uCam;surf=3.;}',
    '    else{',
    '      float pk;float tP=exitProfile(d,JAMB_X,JAMB_Y,IN_R,IN_R,IN_CY,pk);',
    '      if(tP<uCam+REVEAL){t=tP;surf=pk==0.?0.:pk+4.;}',
    '      else{t=uCam+REVEAL;surf=7.;}',
    '    }',
    '  }',
    '  vec3 P=vec3(t*d.x,EYE+t*d.y,uCam-t);',
    '  float fp=t/uF;',                    // tamanho do pixel na superfície (unidades)

    // Vão aberto: névoa que se dissolve e deixa ver a paisagem por trás do canvas.
    '  if(surf==7.){',
    '    vec2 q=vec2(uCam*d.x,EYE+uCam*d.y);',
    '    float ry=q.y>ARC_CY?ARC_R*1.32:ARC_R;',
    '    float r=length(vec2(q.x/ARC_R,(q.y-ARC_CY)/ry));',
    '    float clear=max(uArch*(1.-smoothstep(.45+.75*uArch,1.12+.75*uArch,r)),uCol);',
    '    float a=1.-clear;',
    '    vec3 haze=mix(vec3(1.),vec3(1.,.955,.91),uLight*(1.-smoothstep(.2,1.,r))*.6);',
    '    gl_FragColor=vec4(haze*a,a)*uAlpha;return;',
    '  }',

    '  vec3 alb;float amb;',
    '  if(surf==0.){N=vec3(0.,-1.,0.);alb=FLOORC;amb=.62;}',
    '  else if(surf==1.){N=vec3(-sign(P.x),0.,0.);alb=STONE;amb=.54;}',
    '  else if(surf==2.){N=-normalize(vec3(P.x/(uW*uW),(P.y-SPRING)/(uV*uV),0.));alb=VAULT;amb=.44;}',
    '  else if(surf==3.){N=vec3(0.,0.,1.);alb=STONE;amb=.62;}',
    '  else if(surf==4.){N=vec3(0.,0.,1.);alb=STONE;amb=.80;}',
    '  else if(surf==5.){N=vec3(-sign(P.x),0.,0.);alb=STONE;amb=.66;}',
    '  else{N=-normalize(vec3(P.x,P.y-IN_CY,0.));alb=STONE;amb=.56;}',

    // Luz da paisagem: entra pelo vão e ilumina o túnel a partir do fundo.
    '  vec3 Lc=vec3(0.,(JAMB_Y+FLOOR)*.5,-240.);',
    '  vec3 toL=Lc-P;float dist=length(toL);',
    '  float lam=max(dot(N,toL/dist),0.);',
    '  float att=1./(1.+pow(dist/470.,2.));',
    '  float spill=exp(-pow(max(portalSd(P.xy),0.)/170.,2.));',   // luz junto ao vão, na parede do fundo
    '  float ex=lam*att*1.1+(surf==3.?spill*.24:0.);',
    '  vec3 col=alb*(AMB*amb+WARM*ex);',
    // Profundidade pela luz: o fundo recebe a luz quente da paisagem; perto da câmera
    // (em proporção à distância até a saída), sombra.
    '  float dz=max(P.z,0.);',
    '  if(surf<=2.){',
    '    col+=WARM*alb*exp(-dz/220.)*.16;',
    '    col*=mix(1.,.80,smoothstep(.35,.95,dz/uCam));',
    '  }',
    '  if(surf>=5.) col+=WARM*alb*.08;',

    // Juntas discretas: longitudinais no piso e na abóbada, fiadas e painéis nas paredes.
    '  float j=0.;',
    '  if(surf==0.) j=grid(P.x,150.,75.,.9,fp);',
    '  else if(surf==1.){',
    '    j=max(grid(P.y,165.,SPRING,.8,fp),grid(P.z,130.,0.,.8,fp*t/uW));',
    '  }else if(surf==2.){',
    '    float ang=atan(P.x/uW,-(P.y-SPRING)/uV)*uW;',
    '    j=grid(ang,uW*.3927,0.,.8,fp);',
    '  }',
    '  col*=1.-.075*uJoint*j*step(0.,P.z);',

    // Frisos de luz nas junções das paredes com o piso e com a abóbada (só no túnel).
    '  float inT=smoothstep(0.,40.,P.z)*(1.-smoothstep(LEN-40.,LEN,P.z));',
    '  float st=0.;',
    '  if(surf==1.){',
    '    st=line(FLOOR-P.y,2.2,fp)*1.25+exp(-(FLOOR-P.y)/55.)*.34;',
    '    st+=line(P.y-SPRING,1.6,fp)*.85+exp(-abs(P.y-SPRING)/70.)*.24;',
    '  }else if(surf==0.){',
    '    st=exp(-(uW-abs(P.x))/50.)*.36*step(abs(P.x),uW);',
    '  }else if(surf==2.){',
    '    st=exp(-(SPRING-P.y)/70.)*.22;',
    '  }',
    // Compressão suave dos claros (pela luminância, preservando o tom): sem estourar em branco.
    '  float lm=max(col.r,max(col.g,col.b));col/=1.+max(lm-.82,0.)*1.6;',
    // Os frisos vêm depois: linhas finas de luz quente que continuam visíveis sobre a pedra clara.
    '  col=min(col+STRIP*st*inT*uStrip*.75,vec3(1.));',

    // Piso polido: reflexo do vão (céu e sol) e da luz da saída.
    '  float alpha=1.;',
    '  if(surf==0.){',
    '    float yr=2.*FLOOR-(EYE+uCam*d.y);vec2 qr=vec2(uCam*d.x,yr);',
    '    float blur=10.+max(P.z,0.)*.06;',
    '    float m=1.-smoothstep(-blur,blur,portalSd(qr));',
    '    float graze=1.-smoothstep(0.,.9,d.y*uF/uView.y*2.);',
    '    vec3 rc=mix(SKY,WARM,smoothstep(ARC_CY,FLOOR,yr));',
    '    float sw=uView.x*.03+abs(px.y-uVpY)*.07;',
    '    rc+=WARM*exp(-pow((px.x-uSunX)/sw,2.))*.8;',
    '    col=mix(col,rc,m*(.16+.30*graze)*uCol);',
    // Junto ao vão, o piso se dissolve na água (sem linha fechando a base do arco).
    '    if(abs(P.x)<JAMB_X+20.){',
    '      float edge=smoothstep(-REVEAL,70.,P.z);',
    '      alpha=1.-(1.-edge)*uCol*(1.-smoothstep(JAMB_X-30.,JAMB_X+20.,abs(P.x)));',
    '    }',
    '  }',

    // Primeira luz: halo quente ao redor do arco, antes de a matéria aparecer.
    '  float halo=exp(-pow(length(vec2(P.x,P.y-ARC_CY))/ARC_R-1.,2.)*3.)*step(abs(P.z),1.);',
    // Exposição: tudo começa branco e ganha tom e contraste progressivamente.
    '  vec3 white=mix(vec3(1.),vec3(1.,.955,.91),uLight*halo*.45);',
    '  col=mix(white,col,uMat);',
    '  gl_FragColor=vec4(col*alpha,alpha)*uAlpha;',
    '}'
  ].join('\n');

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    }
    return shader;
  }

  /* Cria o renderizador. Retorna null se WebGL não estiver disponível ou falhar;
     quem chama segue sem o túnel (ver js/intro.js). onLost: perda do contexto. */
  function create(canvas, geometry, onLost) {
    var gl;
    try {
      var options = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (!gl) return null;
      var high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!high || high.precision < 16) return null;

      var program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource(geometry)));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      gl.useProgram(program);

      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    } catch (e) {
      return null;
    }

    var names = ['uView', 'uDpr', 'uVpY', 'uF', 'uCam', 'uW', 'uV', 'uSunX',
      'uMat', 'uArch', 'uCol', 'uLight', 'uStrip', 'uJoint', 'uAlpha'];
    var u = {};
    for (var i = 0; i < names.length; i++) u[names[i]] = gl.getUniformLocation(program, names[i]);

    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      lost = true;
      if (onLost) onLost();
    });

    var size = { w: 0, h: 0 };
    var maxDpr = 2;
    var MAX_PIXELS = 2.6e6;   // teto de pixels do canvas (desktop grande)

    return {
      resize: function (w, h) {
        // Até 2x: bordas nítidas (superamostragem em telas 1x), com teto de pixels.
        var dpr = Math.min(maxDpr, Math.max(1.5, window.devicePixelRatio || 1), Math.sqrt(MAX_PIXELS / (w * h)));
        size = { w: w, h: h };
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        if (!lost) gl.viewport(0, 0, canvas.width, canvas.height);
      },
      // s: estado da cena (câmera, luz, abertura) calculado por js/intro.js.
      render: function (s) {
        if (lost) return;
        gl.uniform2f(u.uView, size.w, size.h);
        gl.uniform1f(u.uDpr, canvas.width / size.w);
        gl.uniform1f(u.uVpY, s.vanishY);
        gl.uniform1f(u.uF, s.focal);
        gl.uniform1f(u.uCam, s.camera);
        gl.uniform1f(u.uW, s.halfWidth);
        gl.uniform1f(u.uV, s.vaultRise);
        gl.uniform1f(u.uSunX, s.sunX);
        gl.uniform1f(u.uMat, s.matter);
        gl.uniform1f(u.uArch, s.arch);
        gl.uniform1f(u.uCol, s.column);
        gl.uniform1f(u.uLight, s.light);
        gl.uniform1f(u.uStrip, s.strips);
        gl.uniform1f(u.uJoint, s.joints);
        gl.uniform1f(u.uAlpha, s.alpha);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      // Aparelho lento: menos resolução, mesma cena.
      degrade: function () {
        if (maxDpr <= 1) return;
        maxDpr = 1;
        this.resize(size.w, size.h);
      },
      destroy: function () {
        var ext = !lost && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        lost = true;
      }
    };
  }

  window.WemaiTunnel = { create: create };
})();
