const fs = require("fs");
const WebSocket = require("ws");
const { Decoder } = require("@evan/opus");

const { ScreamSink } = require("./dist/scream");

const IP = "";

async function screamdump() {

    const wr = fs.createWriteStream("screamdump.pcm");

    const scream = new ScreamSink({ init() { } });
    const chan = scream.associate("vm2", IP);

    for await (const packet of chan) {
        console.log(packet);
        wr.write(Buffer.from(packet.data.buffer));
    }

}

function wsdump() {

    const wr = fs.createWriteStream("wsdump.pcm");

    const dec = new Decoder({ channels: 2, sample_rate: 48000 });

    const ws = new WebSocket("ws://127.0.0.1:8080");
    ws.on("open", () => {
        ws.send(JSON.stringify({ event: "tune", data: { channel: "vm2" } }));
    });
    var gotheader = false;
    ws.on("message", data => {
        if (!gotheader) {
            gotheader = true;
            return;
        }
        data = dec.decode(data);
        console.log(data);
        wr.write(data);
    });

}

wsdump();