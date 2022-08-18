import { EventEmitter } from "events";
import dgram from "dgram";

import { AudioGateway, PacketData } from "./gateway";

class ScreamChannel implements AsyncIterable<PacketData> {

    private chunks: PacketData[] = [];
    private pending: (PacketData) => void = null;

    constructor(readonly gw: AudioGateway, readonly channel: string) {
        gw.init(channel, { channels: 2, rate: 48000 }, this);
    }

    process(msg: Buffer) {
        const base = msg[0] & 0b10000000 ? 44100 : 48000;
        const mult = msg[0] & 0b01111111;
        const depth = msg[1];
        const chans = msg[2] as 1 | 2;
        const data = msg.subarray(6);
        const size = data.length / (depth / 8);
        const floatize = (1 << (depth - 1));

        if (chans > 2) {
            console.error("unsupported channel count");
            return;
        }

        var input: ArrayBufferView;
        switch (depth) {
            case 8: input = new Int8Array(data.buffer.slice(5)); break;
            case 16: input = new Int16Array(data.buffer.slice(5)); break;
            case 32: input = new Int32Array(data.buffer.slice(5)); break;
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

    constructor(readonly gw: AudioGateway) {
        const sock = dgram.createSocket("udp4");
        sock.bind(4011);
        sock.on("message", (msg, remote) => {
            if (!(remote.address in this.channels)) {
                // unrecognized source address
                return;
            }
            this.channels[remote.address].process(msg);
        });
    }

    associate(channel: string, ip: string) {
        this.channels[ip] = new ScreamChannel(this.gw, channel);
        return this.channels[ip];
    }

}