/* Small, genuinely-playable, single-file games used to seed the store. */

interface SeedGame {
  title: string;
  summary: string;
  description: string;
  tags: string[];
  aiTools: string[];
  html: string;
}

const NEON_SNAKE = [
  "<!doctype html><html><head><meta charset='utf-8'><title>Neon Snake</title>",
  "<style>html,body{margin:0;height:100%;background:#05060a;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#8ff}",
  "canvas{background:#0a0d16;border:1px solid #133;box-shadow:0 0 40px #0ff3}#hud{position:fixed;top:12px;left:12px;font-size:14px;letter-spacing:2px}</style></head>",
  "<body><div id='hud'>SCORE 0</div><canvas id='c' width='420' height='420'></canvas>",
  "<script>",
  "var c=document.getElementById('c'),x=c.getContext('2d'),G=21,N=c.width/G;",
  "var snake=[{x:10,y:10}],dir={x:1,y:0},food={x:15,y:10},score=0,dead=false;",
  "addEventListener('keydown',function(e){var k=e.key;",
  " if(k==='ArrowUp'&&dir.y===0)dir={x:0,y:-1};",
  " else if(k==='ArrowDown'&&dir.y===0)dir={x:0,y:1};",
  " else if(k==='ArrowLeft'&&dir.x===0)dir={x:-1,y:0};",
  " else if(k==='ArrowRight'&&dir.x===0)dir={x:1,y:0};",
  " else if(dead&&k===' '){snake=[{x:10,y:10}];dir={x:1,y:0};score=0;dead=false;}});",
  "function place(){food={x:(Math.random()*G)|0,y:(Math.random()*G)|0};}",
  "function step(){",
  " if(dead)return;",
  " var h={x:(snake[0].x+dir.x+G)%G,y:(snake[0].y+dir.y+G)%G};",
  " for(var i=0;i<snake.length;i++)if(snake[i].x===h.x&&snake[i].y===h.y){dead=true;return;}",
  " snake.unshift(h);",
  " if(h.x===food.x&&h.y===food.y){score++;document.getElementById('hud').textContent='SCORE '+score;place();}",
  " else snake.pop();",
  "}",
  "function draw(){",
  " x.fillStyle='#0a0d16';x.fillRect(0,0,c.width,c.height);",
  " x.fillStyle='#f0f';x.fillRect(food.x*N+2,food.y*N+2,N-4,N-4);",
  " x.fillStyle='#0ff';for(var i=0;i<snake.length;i++)x.fillRect(snake[i].x*N+1,snake[i].y*N+1,N-2,N-2);",
  " if(dead){x.fillStyle='#8ff';x.font='20px system-ui';x.textAlign='center';x.fillText('GAME OVER — press space',c.width/2,c.height/2);}",
  "}",
  "setInterval(function(){step();draw();},90);draw();",
  "</script></body></html>",
].join("\n");

const COSMIC_CLICKER = [
  "<!doctype html><html><head><meta charset='utf-8'><title>Cosmic Clicker</title>",
  "<style>html,body{margin:0;height:100%;background:radial-gradient(circle at 50% 30%,#1b1140,#05030f);",
  "font-family:system-ui,sans-serif;color:#ffe;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;user-select:none}",
  "#star{width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#ffb648 60%,#ff5e5e);",
  "box-shadow:0 0 60px #ffb64899;cursor:pointer;transition:transform .05s}#star:active{transform:scale(.92)}",
  "button{background:#2a1e5c;color:#fff;border:1px solid #6a5acd;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px}",
  "button:disabled{opacity:.4;cursor:not-allowed}h1{margin:0;font-weight:600}</style></head>",
  "<body><h1 id='count'>0 stardust</h1><div id='star'></div>",
  "<div><button id='buy'>Buy probe (10) — +1/s</button></div>",
  "<p id='rate' style='opacity:.7;margin:0'>0 / sec</p>",
  "<script>",
  "var dust=0,perClick=1,perSec=0,probeCost=10;",
  "var cEl=document.getElementById('count'),rEl=document.getElementById('rate'),buy=document.getElementById('buy');",
  "function render(){cEl.textContent=Math.floor(dust)+' stardust';rEl.textContent=perSec+' / sec';",
  " buy.textContent='Buy probe ('+probeCost+') — +1/s';buy.disabled=dust<probeCost;}",
  "document.getElementById('star').addEventListener('click',function(){dust+=perClick;render();});",
  "buy.addEventListener('click',function(){if(dust>=probeCost){dust-=probeCost;perSec++;probeCost=Math.ceil(probeCost*1.35);render();}});",
  "setInterval(function(){dust+=perSec/10;render();},100);render();",
  "</script></body></html>",
].join("\n");

const STARFIELD_DODGE = [
  "<!doctype html><html><head><meta charset='utf-8'><title>Starfield Dodge</title>",
  "<style>html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}",
  "canvas{background:#02030a;border:1px solid #223}</style></head>",
  "<body><canvas id='c' width='400' height='560'></canvas>",
  "<script>",
  "var c=document.getElementById('c'),x=c.getContext('2d');",
  "var ship={x:200,y:500,w:22},keys={},rocks=[],stars=[],t=0,score=0,over=false;",
  "for(var i=0;i<60;i++)stars.push({x:Math.random()*400,y:Math.random()*560,s:Math.random()*2+1});",
  "addEventListener('keydown',function(e){keys[e.key]=true;if(over&&e.key===' ')reset();});",
  "addEventListener('keyup',function(e){keys[e.key]=false;});",
  "function reset(){rocks=[];score=0;over=false;ship.x=200;}",
  "function loop(){",
  " t++;x.fillStyle='#02030a';x.fillRect(0,0,400,560);",
  " x.fillStyle='#7fd';for(var i=0;i<stars.length;i++){var s=stars[i];s.y+=s.s;if(s.y>560){s.y=0;s.x=Math.random()*400;}x.fillRect(s.x,s.y,s.s,s.s);}",
  " if(!over){",
  "  if(keys['ArrowLeft'])ship.x-=4;if(keys['ArrowRight'])ship.x+=4;",
  "  ship.x=Math.max(12,Math.min(388,ship.x));",
  "  if(t%26===0)rocks.push({x:Math.random()*370+15,y:-20,r:Math.random()*14+8,v:Math.random()*2+2});",
  "  for(var j=rocks.length-1;j>=0;j--){var r=rocks[j];r.y+=r.v;",
  "   var dx=r.x-ship.x,dy=r.y-ship.y;if(dx*dx+dy*dy<(r.r+ship.w/2)*(r.r+ship.w/2))over=true;",
  "   if(r.y>580){rocks.splice(j,1);score++;}}",
  " }",
  " x.fillStyle='#f95';for(var k=0;k<rocks.length;k++){x.beginPath();x.arc(rocks[k].x,rocks[k].y,rocks[k].r,0,7);x.fill();}",
  " x.fillStyle='#6cf';x.beginPath();x.moveTo(ship.x,ship.y-14);x.lineTo(ship.x-12,ship.y+12);x.lineTo(ship.x+12,ship.y+12);x.fill();",
  " x.fillStyle='#fff';x.font='16px system-ui';x.fillText('Score '+score,12,24);",
  " if(over){x.textAlign='center';x.fillText('CRASHED — press space to retry',200,280);x.textAlign='left';}",
  " requestAnimationFrame(loop);",
  "}loop();",
  "</script></body></html>",
].join("\n");

export const SEED_GAMES: SeedGame[] = [
  {
    title: "Neon Snake",
    summary: "The classic snake, dressed up in synthwave neon. Arrow keys to steer.",
    description:
      "A tiny take on Snake built as a one-shot with an AI assistant. Wrap-around walls, glowing trail, press space to restart after you bite yourself.",
    tags: ["arcade", "retro", "snake", "single player"],
    aiTools: ["Claude"],
    html: NEON_SNAKE,
  },
  {
    title: "Cosmic Clicker",
    summary: "Tap a dying star for stardust, buy probes, watch the number go up.",
    description:
      "A minimal idle/incremental game. Click the star, spend stardust on probes that auto-generate more. Escalating costs keep it going.",
    tags: ["idle", "incremental", "casual"],
    aiTools: ["Claude"],
    html: COSMIC_CLICKER,
  },
  {
    title: "Starfield Dodge",
    summary: "Pilot a ship through an asteroid shower. Survive, rack up score.",
    description:
      "Left/right arrows to dodge falling rocks. Difficulty ramps with a parallax starfield behind you. Press space to retry.",
    tags: ["arcade", "action", "dodge", "single player"],
    aiTools: ["Claude"],
    html: STARFIELD_DODGE,
  },
];
