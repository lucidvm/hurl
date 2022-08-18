import fs from "fs";
import path from "path";

import { AudioGateway } from "./gateway";
import { ScreamSink } from "./scream";

const config: { [chan: string]: string; } = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "hurl.json")).toString());

const gw = new AudioGateway();
const sink = new ScreamSink(gw);
for (const channel in config) {
    const ip = config[channel];
    sink.associate(channel, ip);
}