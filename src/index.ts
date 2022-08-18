import fs from "fs";
import path from "path";

import { AudioGateway } from "./gateway";
import { ScreamSink } from "./scream";

const config: {
    port: number;
    channels: { [chan: string]: string; };
} = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "hurl.json")).toString());

const gw = new AudioGateway();
const sink = new ScreamSink(gw, config.port);
for (const channel in config.channels) {
    const ip = config.channels[channel];
    sink.associate(channel, ip);
}