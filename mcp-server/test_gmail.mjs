import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:39571');
let step = 0;

ws.on('open', () => {
  console.log('✅ Connected to CoDriver');
  ws.send(JSON.stringify({type:'AUTH', token:'codriver-dev-token-2026'}));
});

ws.on('message', (d) => {
  const msg = JSON.parse(d.toString());
  console.log('←', JSON.stringify(msg).slice(0,200));
  step++;
  if (step === 1) {
    ws.send(JSON.stringify({type:'NAVIGATE', url:'https://mail.google.com', requestId:'nav-1'}));
    console.log('→ Navigating to Gmail...');
  } else if (step === 2) {
    console.log('→ Waiting for page to load...');
    setTimeout(() => {
      ws.send(JSON.stringify({type:'GET_CONTENT', requestId:'get-1'}));
    }, 3000);
  } else {
    console.log('\n📧 Gmail content received!');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', e => { console.log('❌ Error:', e.message); process.exit(1); });
setTimeout(() => { console.log('⏱ Timeout - extension may not be connected'); ws.close(); process.exit(0); }, 20000);
