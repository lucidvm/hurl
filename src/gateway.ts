import { WebSocket, Server } from "ws";
import { Encoder } from "@evan/opus";

interface ClientContext {
    channel: string;
    ws: WebSocket;
}

export interface ChannelMode {
    rate: number;
    channels: 1 | 2;
}

interface ChannelContext {
    encoder: Encoder;
    mode: ChannelMode;
}

export interface PacketData {
    data: Float32Array;
    mode: ChannelMode;
}

export class AudioGateway {

    private server: Server;
    private clients: ClientContext[] = [];
    private channels: { [key: string]: ChannelContext } = {};

    constructor(port: number = 8080) {
        this.server = new Server({ port });
        this.server.on("connection", ws => {
            const ctx = { channel: "default", ws };
            this.clients.push(ctx);
            if ("default" in this.channels) {
                const cc = this.channels["default"];
                ws.send(JSON.stringify({
                    event: "mode",
                    data: {
                        channels: cc.mode.channels,
                        rate: cc.mode.rate
                    }
                }));
            }
            ws.on("close", () => {
                const index = this.clients.indexOf(ctx);
                if (index === -1) return; // ???
                this.clients.splice(index, 1);
            });
            ws.on("message", payload => {
                var payloadstr = payload.toString();
                try {
                    const msg = JSON.parse(payloadstr);
                    if (typeof msg.event !== "string" || typeof msg.data !== "object") {
                        throw new Error("malformed command received");
                    }
                    const data = msg.data;
                    switch (msg.event) {
                        case "tune":
                            if (typeof data.channel !== "string") {
                                throw new Error("non-string channel provided");
                            }
                            ctx.channel = data.channel;
                            if (data.channel in this.channels) {
                                const chan = this.channels[data.channel];
                                ws.send(JSON.stringify({
                                    event: "mode",
                                    data: {
                                        channels: chan.mode.channels,
                                        rate: chan.mode.rate
                                    }
                                }));
                            }
                            break;
                        default:
                            throw new Error("invalid command received");
                    }
                }
                catch (ex) {
                    console.error("error processing message from client, dropping them");
                    console.error(ex);
                    ws.close();
                }
            });
        });
    }

    private broadcast(channel: string, event: string, data: any) {
        for (const client of this.clients) {
            if (client.channel === channel) {
                client.ws.send(JSON.stringify({ event, data }));
            }
        }
    }

    private broadcastFrame(channel: string, frame: Buffer) {
        for (const client of this.clients) {
            if (client.channel === channel) {
                client.ws.send(frame);
            }
        }
    }

    init(channel: string, mode: ChannelMode, stream: AsyncIterable<PacketData>): ChannelContext {
        var ctx = this.channels[channel];
        var n = false;

        if (ctx == null) {
            ctx = {
                encoder: null,
                mode: null
            };
            this.channels[channel] = ctx;
            n = true;
        }

        ctx.mode = mode;

        if (n || ctx.encoder.channels !== mode.channels) {
            ctx.encoder = new Encoder({
                sample_rate: 48000,
                channels: mode.channels,
                application: "audio"
            });
            ctx.encoder.bitrate = 64000 * mode.channels;
            ctx.encoder.signal = "music";
            ctx.encoder.reset();
        }

        const _this = this;
        const procstream = ctx.encoder.encode_pcm_stream(960, {
            [Symbol.asyncIterator]() {
                const iter = stream[Symbol.asyncIterator]();
                return {
                    async next() {
                        const x: IteratorResult<PacketData, PacketData> = await iter.next();
                        var data = x.value.data;
                        const mode = x.value.mode;

                        if (mode.channels !== ctx.mode.channels || mode.rate !== ctx.mode.rate) {
                            // mode switch, thread the needle once more...
                            console.warn("reinitializing...", mode, ctx.mode);
                            _this.init(channel, mode, stream);
                            // FIXME: information loss during mode switches
                            return { done: true, value: null };
                        }

                        var value = new Int16Array(data.length);
                        for (var i = 0; i < data.length; i++) {
                            const x = Math.floor(data[i] * 0x7FFF);
                            value[i] = x;
                            if (value[i] !== x) throw new Error("OVERFLOW " + data[i] + " " + x);
                        }

                        return { done: x.done, value };
                    }
                };
            }
        });
        setTimeout(async () => {
            for await (const chunk of procstream) {
                if (chunk == null) break;
                this.broadcastFrame(channel, Buffer.from(chunk));
            }
        });

        this.broadcast(channel, "mode", { channels: mode.channels, rate: mode.rate });

        return ctx;
    }

}