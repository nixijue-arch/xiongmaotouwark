// 2D 横向场景库 — 沙雕动画通用背景图
//
// 全部内联 SVG (1280x720, dataURL 编码), 不依赖文件下载. 推翻前版本 museum 图.
// 沙雕风格通用做法 (短剧抖音/B站): 简笔 flat color 横屏背景 + 上层熊猫头表演.
//
// 加新场景: 拷贝任一 `make*` builder, 改 path/rect → push 到 ANIMATE_SCENES.
// 想换图: 改对应 builder 内的 SVG 字符串.

import type { Material } from './materials';

const W = 1280;
const H = 720;

// SVG → dataURL (UTF-8 safe). 用 encodeURIComponent + 替换 # %23 防 url() parse 错
function svgToDataURL(svg: string): string {
  const compact = svg.replace(/\n\s*/g, ' ').trim();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(compact);
}

// 通用 wrap — viewBox + 显式 width/height 让 HTML img 拿到正确 intrinsic size (1280x720)
// 不设 width/height 浏览器会 fallback 到 300x150 默认 intrinsic, objectFit:cover 算错 scale → 显示不全
function wrap(inner: string, sky = '#bce0ff'): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'>
<rect width='${W}' height='${H}' fill='${sky}'/>
${inner}
</svg>`;
}

// 1. 卧室 (夜) — 床/窗户/月亮/床头灯
const sceneBedroom = wrap(`
<rect x='0' y='0' width='${W}' height='430' fill='#2e2761'/>
<rect x='0' y='430' width='${W}' height='290' fill='#7a5d3a'/>
<rect x='0' y='420' width='${W}' height='14' fill='#5b3d22'/>
<circle cx='990' cy='150' r='62' fill='#ffe9a8'/>
<circle cx='1015' cy='135' r='62' fill='#2e2761'/>
<rect x='80' y='120' width='260' height='220' fill='#0d0a3b' stroke='#fff' stroke-width='6'/>
<line x1='210' y1='120' x2='210' y2='340' stroke='#fff' stroke-width='4'/>
<line x1='80' y1='230' x2='340' y2='230' stroke='#fff' stroke-width='4'/>
<rect x='420' y='430' width='560' height='200' fill='#e8dcc4' stroke='#5b3d22' stroke-width='6'/>
<rect x='420' y='430' width='560' height='40' fill='#ffd7d7'/>
<rect x='460' y='380' width='180' height='70' rx='12' fill='#fff' stroke='#5b3d22' stroke-width='4'/>
<rect x='720' y='380' width='220' height='70' rx='12' fill='#fff' stroke='#5b3d22' stroke-width='4'/>
<rect x='1040' y='480' width='180' height='190' fill='#a87b48' stroke='#5b3d22' stroke-width='5'/>
<circle cx='1130' cy='430' r='38' fill='#ffd66b'/>
<rect x='1115' y='460' width='30' height='30' fill='#7a5d3a'/>
<circle cx='200' cy='560' r='8' fill='#fff' opacity='0.5'/>
<circle cx='340' cy='620' r='6' fill='#fff' opacity='0.4'/>
`, '#0d0a3b');

// 2. 客厅 — 沙发/电视/茶几/落地灯
const sceneLivingRoom = wrap(`
<rect x='0' y='0' width='${W}' height='460' fill='#f5e5c8'/>
<rect x='0' y='460' width='${W}' height='260' fill='#c9a978'/>
<rect x='0' y='450' width='${W}' height='12' fill='#8c6a3a'/>
<rect x='80' y='180' width='320' height='200' fill='#1b1b1b' stroke='#444' stroke-width='8'/>
<rect x='100' y='200' width='280' height='160' fill='#5fd6ff'/>
<rect x='180' y='380' width='120' height='40' fill='#444'/>
<rect x='480' y='340' width='420' height='170' rx='16' fill='#d97757'/>
<rect x='500' y='320' width='110' height='40' rx='8' fill='#d97757'/>
<rect x='620' y='320' width='110' height='40' rx='8' fill='#d97757'/>
<rect x='740' y='320' width='110' height='40' rx='8' fill='#d97757'/>
<rect x='540' y='540' width='300' height='60' rx='6' fill='#7a4a2a'/>
<circle cx='560' cy='620' r='14' fill='#5a3a1f'/>
<circle cx='820' cy='620' r='14' fill='#5a3a1f'/>
<rect x='1040' y='200' width='30' height='340' fill='#8c6a3a'/>
<path d='M 985 200 L 1125 200 L 1095 130 L 1015 130 Z' fill='#ffe5a8' stroke='#8c6a3a' stroke-width='4'/>
<circle cx='1055' cy='560' r='28' fill='#3a2614'/>
`, '#fff5e0');

// 3. 办公室 — 工位/显示器/转椅/绿植
const sceneOffice = wrap(`
<rect x='0' y='0' width='${W}' height='440' fill='#e8eef5'/>
<rect x='0' y='440' width='${W}' height='280' fill='#9aa3ad'/>
<rect x='0' y='432' width='${W}' height='10' fill='#5d6670'/>
<line x1='200' y1='0' x2='200' y2='440' stroke='#c5cdd6' stroke-width='3'/>
<line x1='600' y1='0' x2='600' y2='440' stroke='#c5cdd6' stroke-width='3'/>
<line x1='1000' y1='0' x2='1000' y2='440' stroke='#c5cdd6' stroke-width='3'/>
<rect x='420' y='480' width='560' height='30' fill='#3a342a'/>
<rect x='430' y='510' width='30' height='160' fill='#3a342a'/>
<rect x='940' y='510' width='30' height='160' fill='#3a342a'/>
<rect x='520' y='320' width='280' height='190' fill='#1b1b1b' stroke='#444' stroke-width='6'/>
<rect x='540' y='340' width='240' height='150' fill='#5fd6ff'/>
<rect x='640' y='510' width='40' height='30' fill='#444'/>
<rect x='620' y='540' width='80' height='10' fill='#444'/>
<rect x='820' y='400' width='110' height='90' fill='#222'/>
<rect x='830' y='410' width='90' height='70' fill='#5fd6ff'/>
<circle cx='250' cy='600' r='52' fill='#3aa05a'/>
<path d='M 245 560 L 225 480 M 250 560 L 270 470 M 255 560 L 280 500' stroke='#2c7a48' stroke-width='6'/>
<rect x='225' y='600' width='52' height='60' fill='#a06a3a'/>
<rect x='1080' y='540' width='130' height='160' fill='#7a5d3a' stroke='#5b3d22' stroke-width='5'/>
<rect x='1085' y='560' width='120' height='30' fill='#5b3d22'/>
<rect x='1085' y='610' width='120' height='30' fill='#5b3d22'/>
<circle cx='1100' cy='574' r='4' fill='#ffd66b'/>
`, '#cfd9e5');

// 4. 街道 — 楼/马路/路灯/天空
const sceneStreet = wrap(`
<rect x='0' y='0' width='${W}' height='480' fill='#a8d3ff'/>
<rect x='0' y='480' width='${W}' height='240' fill='#5a5a5a'/>
<rect x='0' y='480' width='${W}' height='10' fill='#fff'/>
<rect x='100' y='540' width='80' height='8' fill='#fff'/>
<rect x='280' y='540' width='80' height='8' fill='#fff'/>
<rect x='460' y='540' width='80' height='8' fill='#fff'/>
<rect x='640' y='540' width='80' height='8' fill='#fff'/>
<rect x='820' y='540' width='80' height='8' fill='#fff'/>
<rect x='1000' y='540' width='80' height='8' fill='#fff'/>
<rect x='80' y='200' width='180' height='280' fill='#e07a5f'/>
<rect x='100' y='230' width='40' height='40' fill='#fff5b0'/>
<rect x='160' y='230' width='40' height='40' fill='#fff5b0'/>
<rect x='220' y='230' width='40' height='40' fill='#fff5b0'/>
<rect x='100' y='290' width='40' height='40' fill='#fff5b0'/>
<rect x='160' y='290' width='40' height='40' fill='#fff5b0'/>
<rect x='220' y='290' width='40' height='40' fill='#fff5b0'/>
<rect x='100' y='350' width='40' height='40' fill='#fff5b0'/>
<rect x='160' y='350' width='40' height='40' fill='#fff5b0'/>
<rect x='220' y='350' width='40' height='40' fill='#fff5b0'/>
<rect x='320' y='120' width='220' height='360' fill='#6b7c93'/>
<g fill='#a8c6e0'>
<rect x='340' y='140' width='40' height='50'/><rect x='400' y='140' width='40' height='50'/><rect x='460' y='140' width='40' height='50'/>
<rect x='340' y='210' width='40' height='50'/><rect x='400' y='210' width='40' height='50'/><rect x='460' y='210' width='40' height='50'/>
<rect x='340' y='280' width='40' height='50'/><rect x='400' y='280' width='40' height='50'/><rect x='460' y='280' width='40' height='50'/>
<rect x='340' y='350' width='40' height='50'/><rect x='400' y='350' width='40' height='50'/><rect x='460' y='350' width='40' height='50'/>
</g>
<rect x='600' y='240' width='160' height='240' fill='#dbb84a'/>
<g fill='#7a5d3a'>
<rect x='620' y='260' width='35' height='40'/><rect x='670' y='260' width='35' height='40'/><rect x='720' y='260' width='35' height='40'/>
<rect x='620' y='320' width='35' height='40'/><rect x='670' y='320' width='35' height='40'/><rect x='720' y='320' width='35' height='40'/>
<rect x='620' y='380' width='35' height='40'/><rect x='670' y='380' width='35' height='40'/><rect x='720' y='380' width='35' height='40'/>
</g>
<rect x='820' y='180' width='200' height='300' fill='#3aa05a'/>
<rect x='1080' y='250' width='140' height='230' fill='#c84a4a'/>
<rect x='950' y='350' width='30' height='130' fill='#2a2a2a'/>
<circle cx='965' cy='335' r='28' fill='#ffd66b'/>
<line x1='965' y1='335' x2='965' y2='200' stroke='#2a2a2a' stroke-width='4'/>
<g fill='#fff'>
<ellipse cx='200' cy='100' rx='60' ry='18'/><ellipse cx='240' cy='90' rx='40' ry='14'/>
<ellipse cx='820' cy='80' rx='70' ry='20'/><ellipse cx='870' cy='70' rx='50' ry='14'/>
</g>
`);

// 5. 教室 — 黑板/课桌/讲台/挂图
const sceneClassroom = wrap(`
<rect x='0' y='0' width='${W}' height='460' fill='#fff5dc'/>
<rect x='0' y='460' width='${W}' height='260' fill='#a07a4a'/>
<rect x='0' y='452' width='${W}' height='10' fill='#6a4a22'/>
<rect x='220' y='90' width='620' height='280' fill='#2c5a3a' stroke='#5a3a1c' stroke-width='10'/>
<text x='350' y='220' font-family='sans-serif' font-size='80' fill='#fff' font-weight='bold' letter-spacing='6'>上课啦</text>
<rect x='280' y='340' width='60' height='8' fill='#fff'/>
<rect x='360' y='340' width='40' height='8' fill='#ffd66b'/>
<rect x='900' y='130' width='160' height='200' fill='#fff' stroke='#666' stroke-width='4'/>
<text x='930' y='200' font-family='sans-serif' font-size='32' fill='#333'>中国</text>
<rect x='160' y='500' width='180' height='110' fill='#e8c574' stroke='#7a5a2a' stroke-width='5'/>
<rect x='170' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='300' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='550' y='500' width='180' height='110' fill='#e8c574' stroke='#7a5a2a' stroke-width='5'/>
<rect x='560' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='690' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='940' y='500' width='180' height='110' fill='#e8c574' stroke='#7a5a2a' stroke-width='5'/>
<rect x='950' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='1080' y='610' width='30' height='90' fill='#5a3a1c'/>
<rect x='80' y='380' width='80' height='100' fill='#a07a4a'/>
<rect x='80' y='380' width='80' height='10' fill='#7a5a2a'/>
`, '#fff5dc');

// 6. 公园 — 草地/树/长椅/太阳
const scenePark = wrap(`
<rect x='0' y='0' width='${W}' height='420' fill='#a8e0ff'/>
<rect x='0' y='420' width='${W}' height='300' fill='#5fc46a'/>
<rect x='0' y='418' width='${W}' height='6' fill='#3a8a3f'/>
<circle cx='200' cy='130' r='60' fill='#ffd66b'/>
<g fill='#fff' opacity='0.85'>
<ellipse cx='580' cy='150' rx='80' ry='24'/><ellipse cx='620' cy='130' rx='52' ry='18'/>
<ellipse cx='1000' cy='90' rx='70' ry='20'/><ellipse cx='1050' cy='80' rx='50' ry='14'/>
</g>
<rect x='340' y='350' width='40' height='180' fill='#5a3a1c'/>
<circle cx='360' cy='320' r='110' fill='#3a8a3f'/>
<circle cx='320' cy='300' r='80' fill='#4caa50'/>
<circle cx='420' cy='300' r='70' fill='#4caa50'/>
<rect x='870' y='370' width='40' height='160' fill='#5a3a1c'/>
<circle cx='890' cy='340' r='100' fill='#3a8a3f'/>
<circle cx='850' cy='320' r='70' fill='#4caa50'/>
<rect x='540' y='520' width='220' height='30' fill='#a07a4a' stroke='#5a3a1c' stroke-width='4'/>
<rect x='540' y='480' width='220' height='30' rx='8' fill='#a07a4a' stroke='#5a3a1c' stroke-width='4'/>
<rect x='550' y='550' width='14' height='80' fill='#5a3a1c'/>
<rect x='736' y='550' width='14' height='80' fill='#5a3a1c'/>
<circle cx='100' cy='560' r='8' fill='#ffeb6b'/>
<circle cx='1100' cy='580' r='8' fill='#ff6b9a'/>
<circle cx='1180' cy='620' r='10' fill='#fff'/>
<path d='M 70 660 Q 90 640 110 660 Q 130 640 150 660' stroke='#3a8a3f' stroke-width='3' fill='none'/>
<path d='M 1000 670 Q 1020 650 1040 670 Q 1060 650 1080 670' stroke='#3a8a3f' stroke-width='3' fill='none'/>
`);

// 7. 餐厅 — 桌椅/盘子/吊灯
const sceneRestaurant = wrap(`
<rect x='0' y='0' width='${W}' height='480' fill='#f0d4a8'/>
<rect x='0' y='480' width='${W}' height='240' fill='#8c4a2a'/>
<rect x='0' y='472' width='${W}' height='10' fill='#5a2a1a'/>
<line x1='540' y1='0' x2='540' y2='180' stroke='#5a3a1c' stroke-width='6'/>
<ellipse cx='540' cy='220' rx='110' ry='30' fill='#ffe5a8' stroke='#5a3a1c' stroke-width='5'/>
<rect x='510' y='220' width='60' height='40' fill='#ffd66b'/>
<line x1='1000' y1='0' x2='1000' y2='160' stroke='#5a3a1c' stroke-width='6'/>
<ellipse cx='1000' cy='200' rx='90' ry='25' fill='#ffe5a8' stroke='#5a3a1c' stroke-width='5'/>
<rect x='180' y='430' width='340' height='180' rx='8' fill='#e8c574' stroke='#5a3a1c' stroke-width='5'/>
<rect x='200' y='590' width='30' height='130' fill='#5a3a1c'/>
<rect x='470' y='590' width='30' height='130' fill='#5a3a1c'/>
<circle cx='280' cy='480' r='40' fill='#fff' stroke='#9aa' stroke-width='3'/>
<circle cx='280' cy='480' r='24' fill='#d97757'/>
<circle cx='420' cy='480' r='38' fill='#fff' stroke='#9aa' stroke-width='3'/>
<circle cx='420' cy='480' r='22' fill='#3a8a3f'/>
<rect x='730' y='430' width='320' height='180' rx='8' fill='#e8c574' stroke='#5a3a1c' stroke-width='5'/>
<rect x='750' y='590' width='30' height='130' fill='#5a3a1c'/>
<rect x='1010' y='590' width='30' height='130' fill='#5a3a1c'/>
<rect x='820' y='460' width='160' height='30' rx='4' fill='#fff'/>
<circle cx='840' cy='475' r='10' fill='#ffd66b'/>
<rect x='900' y='467' width='70' height='16' fill='#7a5d3a'/>
<rect x='80' y='150' width='60' height='280' fill='#f3a6c2' stroke='#9a3a5a' stroke-width='4'/>
<rect x='1140' y='200' width='70' height='240' fill='#a8e0ff' stroke='#6b7c93' stroke-width='4'/>
`, '#f0d4a8');

// 8. 厨房 — 灶台/橱柜/锅/油烟机
const sceneKitchen = wrap(`
<rect x='0' y='0' width='${W}' height='340' fill='#f0e0c4'/>
<rect x='0' y='340' width='${W}' height='80' fill='#a87a4a'/>
<rect x='0' y='420' width='${W}' height='180' fill='#f5f5f5'/>
<rect x='0' y='600' width='${W}' height='120' fill='#c0a878'/>
<rect x='0' y='594' width='${W}' height='10' fill='#7a5a2a'/>
<rect x='100' y='430' width='280' height='170' fill='#fff' stroke='#666' stroke-width='4'/>
<rect x='110' y='440' width='260' height='100' fill='#cfd9e5'/>
<rect x='150' y='560' width='30' height='30' fill='#888'/>
<rect x='220' y='560' width='30' height='30' fill='#888'/>
<rect x='290' y='560' width='30' height='30' fill='#888'/>
<rect x='450' y='430' width='280' height='170' fill='#2c2c2c'/>
<rect x='470' y='450' width='100' height='80' fill='#0a0a0a'/>
<circle cx='520' cy='490' r='14' fill='#ff6b6b'/>
<rect x='610' y='450' width='100' height='80' fill='#0a0a0a'/>
<circle cx='660' cy='490' r='14' fill='#ff6b6b'/>
<ellipse cx='520' cy='430' rx='50' ry='12' fill='#7a7a7a'/>
<rect x='495' y='400' width='50' height='35' fill='#7a7a7a'/>
<rect x='540' y='405' width='10' height='25' fill='#5a3a1c'/>
<rect x='800' y='430' width='280' height='170' fill='#fff' stroke='#666' stroke-width='4'/>
<rect x='810' y='440' width='130' height='150' rx='4' fill='#dbe6f0'/>
<rect x='950' y='440' width='120' height='70' rx='4' fill='#dbe6f0'/>
<rect x='950' y='520' width='120' height='70' rx='4' fill='#dbe6f0'/>
<rect x='1100' y='190' width='130' height='150' fill='#888'/>
<rect x='1120' y='210' width='90' height='110' fill='#5a5a5a'/>
<rect x='100' y='150' width='280' height='80' fill='#888' stroke='#555' stroke-width='3'/>
<rect x='150' y='130' width='180' height='20' fill='#888'/>
`, '#f0e0c4');

// 9. 地铁车厢 — 车厢/座椅/扶手/把杆
const sceneSubway = wrap(`
<rect x='0' y='0' width='${W}' height='${H}' fill='#2a3340'/>
<rect x='0' y='0' width='${W}' height='100' fill='#3a4554'/>
<rect x='0' y='620' width='${W}' height='100' fill='#1a232c'/>
<rect x='0' y='100' width='90' height='520' fill='#5a6878'/>
<rect x='1190' y='100' width='90' height='520' fill='#5a6878'/>
<rect x='110' y='120' width='1060' height='240' fill='#6a7a8c'/>
<rect x='110' y='120' width='1060' height='40' fill='#3a4554'/>
<g fill='#a8c6e0'>
<rect x='130' y='180' width='200' height='160'/><rect x='350' y='180' width='200' height='160'/>
<rect x='570' y='180' width='200' height='160'/><rect x='790' y='180' width='200' height='160'/>
<rect x='1010' y='180' width='160' height='160'/>
</g>
<g fill='#1f2933'>
<rect x='130' y='180' width='200' height='160' opacity='0.15'/>
</g>
<rect x='200' y='100' width='4' height='420' fill='#cfd9e5'/>
<rect x='500' y='100' width='4' height='420' fill='#cfd9e5'/>
<rect x='800' y='100' width='4' height='420' fill='#cfd9e5'/>
<rect x='1080' y='100' width='4' height='420' fill='#cfd9e5'/>
<circle cx='202' cy='420' r='22' fill='none' stroke='#cfd9e5' stroke-width='6'/>
<circle cx='502' cy='420' r='22' fill='none' stroke='#cfd9e5' stroke-width='6'/>
<circle cx='802' cy='420' r='22' fill='none' stroke='#cfd9e5' stroke-width='6'/>
<circle cx='1082' cy='420' r='22' fill='none' stroke='#cfd9e5' stroke-width='6'/>
<rect x='130' y='540' width='1040' height='80' rx='12' fill='#7a5d3a' stroke='#5a3a1c' stroke-width='4'/>
<rect x='140' y='620' width='30' height='80' fill='#5a3a1c'/>
<rect x='1130' y='620' width='30' height='80' fill='#5a3a1c'/>
<g fill='#fff' opacity='0.6'>
<rect x='110' y='80' width='1060' height='4'/>
</g>
`, '#2a3340');

// 10. 山林 — 远山/树/云
const sceneMountain = wrap(`
<rect x='0' y='0' width='${W}' height='480' fill='#a8e8ff'/>
<rect x='0' y='480' width='${W}' height='240' fill='#5a8a4a'/>
<g fill='#fff' opacity='0.9'>
<ellipse cx='250' cy='130' rx='80' ry='24'/><ellipse cx='290' cy='115' rx='52' ry='18'/>
<ellipse cx='950' cy='100' rx='90' ry='26'/><ellipse cx='1010' cy='85' rx='60' ry='18'/>
</g>
<circle cx='1100' cy='160' r='70' fill='#ffd66b'/>
<path d='M -50 480 L 250 200 L 450 380 L 600 280 L 800 480 Z' fill='#6b7c93'/>
<path d='M 250 200 L 290 240 L 220 250 Z' fill='#fff'/>
<path d='M 500 480 L 800 230 L 1050 360 L 1330 480 Z' fill='#5d7080'/>
<path d='M 800 230 L 830 270 L 770 280 Z' fill='#fff'/>
<g>
<rect x='180' y='540' width='14' height='90' fill='#5a3a1c'/>
<path d='M 186 460 L 130 580 L 240 580 Z' fill='#2c5a3a'/>
<path d='M 186 510 L 140 600 L 230 600 Z' fill='#2c5a3a'/>
<path d='M 186 550 L 150 620 L 220 620 Z' fill='#2c5a3a'/>
</g>
<g>
<rect x='1040' y='540' width='14' height='90' fill='#5a3a1c'/>
<path d='M 1046 460 L 990 580 L 1100 580 Z' fill='#2c5a3a'/>
<path d='M 1046 510 L 1000 600 L 1090 600 Z' fill='#2c5a3a'/>
</g>
<g>
<rect x='420' y='560' width='14' height='80' fill='#5a3a1c'/>
<path d='M 426 480 L 380 580 L 470 580 Z' fill='#2c5a3a'/>
<path d='M 426 540 L 390 620 L 460 620 Z' fill='#2c5a3a'/>
</g>
<g>
<rect x='820' y='560' width='14' height='80' fill='#5a3a1c'/>
<path d='M 826 480 L 780 580 L 870 580 Z' fill='#2c5a3a'/>
<path d='M 826 540 L 790 620 L 860 620 Z' fill='#2c5a3a'/>
</g>
<g>
<rect x='620' y='580' width='14' height='80' fill='#5a3a1c'/>
<path d='M 626 510 L 590 600 L 670 600 Z' fill='#2c5a3a'/>
</g>
<path d='M 0 660 Q 200 640 400 660 Q 600 640 800 660 Q 1000 640 1280 660 L 1280 720 L 0 720 Z' fill='#3a6a3a'/>
`);

// 11. 海滩 — 海/沙/椰树/太阳
const sceneBeach = wrap(`
<rect x='0' y='0' width='${W}' height='340' fill='#7ad0ff'/>
<rect x='0' y='340' width='${W}' height='200' fill='#3a8acc'/>
<rect x='0' y='540' width='${W}' height='180' fill='#fff5c0'/>
<circle cx='1050' cy='150' r='80' fill='#ffd66b'/>
<g stroke='#fff' stroke-width='3' opacity='0.7' fill='none'>
<path d='M 0 380 Q 320 360 640 380 T 1280 380'/>
<path d='M 0 420 Q 320 440 640 420 T 1280 420'/>
<path d='M 0 460 Q 320 440 640 460 T 1280 460'/>
<path d='M 0 500 Q 320 520 640 500 T 1280 500'/>
</g>
<path d='M 0 540 Q 200 520 400 540 Q 600 520 800 540 Q 1000 520 1280 540 L 1280 560 L 0 560 Z' fill='#fff'/>
<g>
<path d='M 200 540 Q 220 380 250 240' stroke='#7a5d3a' stroke-width='14' fill='none'/>
<path d='M 250 240 Q 180 220 130 260' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<path d='M 250 240 Q 320 220 370 260' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<path d='M 250 240 Q 220 170 200 130' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<path d='M 250 240 Q 280 170 310 130' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<circle cx='240' cy='250' r='10' fill='#8c4a2a'/>
<circle cx='260' cy='250' r='10' fill='#8c4a2a'/>
</g>
<g>
<path d='M 1100 540 Q 1120 400 1140 280' stroke='#7a5d3a' stroke-width='12' fill='none'/>
<path d='M 1140 280 Q 1080 260 1040 300' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<path d='M 1140 280 Q 1200 260 1240 300' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
<path d='M 1140 280 Q 1120 220 1100 180' fill='#3aa05a' stroke='#2c7a48' stroke-width='3'/>
</g>
<ellipse cx='620' cy='640' rx='80' ry='14' fill='#e0b878'/>
<rect x='600' y='600' width='40' height='50' rx='8' fill='#ff6b6b'/>
<rect x='840' y='630' width='80' height='12' rx='4' fill='#fff' stroke='#666' stroke-width='2'/>
<rect x='850' y='600' width='8' height='40' fill='#ff6b6b'/>
<rect x='870' y='600' width='8' height='40' fill='#3aa05a'/>
<rect x='890' y='600' width='8' height='40' fill='#ffd66b'/>
<g fill='#fff' opacity='0.9'>
<ellipse cx='420' cy='90' rx='60' ry='18'/><ellipse cx='460' cy='80' rx='40' ry='14'/>
</g>
`, '#7ad0ff');

// 12. 太空 — 星空/月球/地球/飞船
const sceneSpace = wrap(`
<rect x='0' y='0' width='${W}' height='${H}' fill='#0a0a2c'/>
<g fill='#fff'>
<circle cx='80' cy='80' r='2'/><circle cx='180' cy='150' r='3'/><circle cx='280' cy='60' r='2'/>
<circle cx='380' cy='180' r='2'/><circle cx='460' cy='90' r='3'/><circle cx='560' cy='220' r='2'/>
<circle cx='640' cy='40' r='2'/><circle cx='740' cy='160' r='3'/><circle cx='840' cy='90' r='2'/>
<circle cx='940' cy='200' r='2'/><circle cx='1040' cy='70' r='3'/><circle cx='1140' cy='180' r='2'/>
<circle cx='1200' cy='40' r='2'/><circle cx='120' cy='280' r='2'/><circle cx='320' cy='340' r='3'/>
<circle cx='540' cy='380' r='2'/><circle cx='840' cy='340' r='2'/><circle cx='1080' cy='400' r='3'/>
<circle cx='60' cy='480' r='2'/><circle cx='200' cy='560' r='3'/><circle cx='720' cy='540' r='2'/>
<circle cx='1140' cy='580' r='2'/><circle cx='460' cy='620' r='3'/>
</g>
<circle cx='980' cy='180' r='110' fill='#cfd9e5'/>
<circle cx='940' cy='150' r='14' fill='#8c8c9c' opacity='0.6'/>
<circle cx='1000' cy='200' r='22' fill='#8c8c9c' opacity='0.6'/>
<circle cx='1020' cy='150' r='10' fill='#8c8c9c' opacity='0.5'/>
<circle cx='960' cy='220' r='8' fill='#8c8c9c' opacity='0.5'/>
<circle cx='280' cy='480' r='150' fill='#3a6acc'/>
<path d='M 180 430 Q 240 410 280 440 Q 320 420 380 460 Q 360 510 290 500 Q 230 520 180 500 Z' fill='#3aa05a'/>
<path d='M 200 540 Q 240 530 290 550 Q 330 540 360 580 Q 290 600 230 580 Z' fill='#3aa05a'/>
<g fill='#fff' opacity='0.4'>
<ellipse cx='250' cy='450' rx='30' ry='10'/><ellipse cx='340' cy='510' rx='40' ry='12'/>
</g>
<g>
<ellipse cx='720' cy='430' rx='90' ry='28' fill='#cfd9e5'/>
<ellipse cx='720' cy='430' rx='60' ry='18' fill='#5a6878'/>
<path d='M 660 425 L 660 380 Q 720 360 780 380 L 780 425' fill='#a8c6e0' stroke='#5a6878' stroke-width='3'/>
<circle cx='700' cy='400' r='6' fill='#ff6b6b'/>
<circle cx='720' cy='400' r='6' fill='#5fd6ff'/>
<circle cx='740' cy='400' r='6' fill='#ffd66b'/>
<path d='M 670 458 L 660 490 L 680 470 Z' fill='#ff8b3a'/>
<path d='M 720 458 L 720 500 L 735 478 Z' fill='#ff8b3a'/>
<path d='M 770 458 L 780 490 L 760 470 Z' fill='#ff8b3a'/>
</g>
<g stroke='#fff' stroke-width='2' opacity='0.5'>
<line x1='100' y1='240' x2='160' y2='200'/>
<line x1='460' y1='140' x2='520' y2='100'/>
</g>
`, '#0a0a2c');

// 内联 SVG 集合 — 让 ANIMATE_SCENES 装配饰好的 Material[]
interface SceneSpec { id: string; labelCn: string; labelEn: string; tags: string[]; svg: string; }

const SCENE_SPECS: SceneSpec[] = [
  { id: 'scene-bedroom',    labelCn: '卧室',    labelEn: 'Bedroom',     tags: ['场景', '室内', '夜'],     svg: sceneBedroom },
  { id: 'scene-livingroom', labelCn: '客厅',    labelEn: 'Living Room', tags: ['场景', '室内', '日'],     svg: sceneLivingRoom },
  { id: 'scene-office',     labelCn: '办公室',  labelEn: 'Office',      tags: ['场景', '室内', '日'],     svg: sceneOffice },
  { id: 'scene-classroom',  labelCn: '教室',    labelEn: 'Classroom',   tags: ['场景', '室内', '日'],     svg: sceneClassroom },
  { id: 'scene-kitchen',    labelCn: '厨房',    labelEn: 'Kitchen',     tags: ['场景', '室内', '日'],     svg: sceneKitchen },
  { id: 'scene-restaurant', labelCn: '餐厅',    labelEn: 'Restaurant',  tags: ['场景', '室内', '日'],     svg: sceneRestaurant },
  { id: 'scene-street',     labelCn: '街道',    labelEn: 'Street',      tags: ['场景', '室外', '日'],     svg: sceneStreet },
  { id: 'scene-park',       labelCn: '公园',    labelEn: 'Park',        tags: ['场景', '室外', '日'],     svg: scenePark },
  { id: 'scene-subway',     labelCn: '地铁',    labelEn: 'Subway',      tags: ['场景', '交通', '室内'],   svg: sceneSubway },
  { id: 'scene-mountain',   labelCn: '山林',    labelEn: 'Mountain',    tags: ['场景', '室外', '自然'],   svg: sceneMountain },
  { id: 'scene-beach',      labelCn: '海滩',    labelEn: 'Beach',       tags: ['场景', '室外', '自然'],   svg: sceneBeach },
  { id: 'scene-space',      labelCn: '太空',    labelEn: 'Space',       tags: ['场景', '宇宙', '夜'],     svg: sceneSpace },
];

export const ANIMATE_SCENES: Material[] = SCENE_SPECS.map(s => ({
  id: s.id,
  src: svgToDataURL(s.svg),
  labelCn: s.labelCn,
  labelEn: s.labelEn,
  tags: s.tags,
  tagsEn: s.tags.map(t => t),
  faceOffset: { x: 0, y: 0, w: 0, h: 0 },
}));

export const ANIMATE_SCENES_BY_ID: Record<string, Material> = Object.fromEntries(
  ANIMATE_SCENES.map(s => [s.id, s]),
);
