const port = 9222;
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  const send = (m,p) => new Promise(res => { const i=++id; pending.set(i,res); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push('console.'+m.params.type+': '+m.params.args.map(a=>a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: '+(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded') logs.push('log: '+m.params.entry.level+' '+m.params.entry.text);
  });
  await new Promise(r=>ws.addEventListener('open',r));
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await send('Page.enable', {});
  await send('Page.reload', {ignoreCache:false});
  await new Promise(r=>setTimeout(r,7000));
  console.log(logs.slice(-40).join('\n'));
  const r = await send('Runtime.evaluate', {expression:'({app: document.getElementById("app")?.innerHTML.length, rows: document.querySelectorAll(".todo-list-item").length})', returnByValue:true});
  console.log('STATE', JSON.stringify(r.result?.result?.value));
  ws.close();
})();
