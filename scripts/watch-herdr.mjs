import net from 'node:net';
const socket = net.createConnection(process.env.HERDR_SOCKET_PATH, () => {
  socket.write(JSON.stringify({ id: 'dag-observer', method: 'events.subscribe', params: {
    subscriptions: ['pane.created', 'pane.closed', 'pane.agent_detected', 'tab.created', 'tab.closed', 'tab.renamed', 'layout.updated'].map(type => ({ type })) } }) + '\n');
});
let buffer = '';
socket.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    const event = JSON.parse(line);
    if (event.event) console.log(line);
  }
});
socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
