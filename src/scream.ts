import dgram from "dgram";

import { AudioGateway, PacketData } from "./gateway";

const PCMSTART = 5;

class ScreamChannel implements AsyncIterable<PacketData> {

    private chunks: PacketData[] = [];
    private pending: (packet: PacketData) => void = null;

    constructor(readonly gw: AudioGateway, readonly channel: string) {
        gw.init(channel, { channels: 2, rate: 48000 }, this);
    }

    process(msg: Buffer) {
        const base = msg[0] & 0b10000000 ? 44100 : 48000;
        const mult = msg[0] & 0b01111111;
        const depth = msg[1];
        const chans = msg[2] as 1 | 2;
        const data = msg.buffer.slice(PCMSTART);
        const size = (msg.length - PCMSTART) / (depth / 8);
        const floatize = (1 << (depth - 1));

        if (chans > 2) {
            console.error("unsupported channel count");
            return;
        }

        var input: ArrayBufferView;
        switch (depth) {
            case 8: input = new Int8Array(data); break;
            case 16: input = new Int16Array(data); break;
            case 32: input = new Int32Array(data); break;
            default:
                // unsupported
                console.error("unsupported width");
                return;
        }

        const output = new Float32Array(size);
        for (var i = 0; i < output.length; i++) {
            output[i] = input[i] / floatize;
        }

        const packet = {
            data: output,
            mode: {
                rate: base, // FIXME
                channels: chans
            }
        };

        if (this.pending != null) {
            this.pending(packet);
        }
        else {
            this.chunks.push(packet);
        }
    }

    [Symbol.asyncIterator]() {
        const _this = this;
        return {
            next() {
                return new Promise<IteratorResult<PacketData, PacketData>>((resolve, reject) => {
                    if (_this.chunks.length > 0) {
                        resolve({ done: false, value: _this.chunks.shift() });
                    }
                    _this.pending = value => resolve({ done: false, value });
                });
            }
        }
    }

}

export class ScreamSink {

    private channels: { [key: string]: ScreamChannel; } = {};

    constructor(readonly gw: AudioGateway, port = 4011) {
        const sock = dgram.createSocket("udp4");
        sock.bind(port);
        sock.on("message", (msg, remote) => {
            if (!(remote.address in this.channels)) {
                // unrecognized source address
                return;
            }
            this.channels[remote.address].process(msg);
        });
    }

    associate(channel: string, ip: string): ScreamChannel {
        this.channels[ip] = new ScreamChannel(this.gw, channel);
        return this.channels[ip];
    }

}