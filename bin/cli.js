#!/usr/bin/env node
import {createReadStream, readFileSync, writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import zlib from 'node:zlib';
import tarindex from '../index.js';

function buildTarHeader(name, size) {
  const buf = Buffer.alloc(512);
  const mtime = Math.floor(Date.now() / 1000);
  buf.write(name, 0, 'ascii');
  buf.write('0000644\0', 100, 'ascii');
  buf.write('0000000\0', 108, 'ascii');
  buf.write('0000000\0', 116, 'ascii');
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  buf.write(mtime.toString(8).padStart(11, '0') + ' ', 136, 'ascii');
  buf.fill(0x20, 148, 156); // checksum placeholder = spaces
  buf[156] = 48; // typeflag '0' = regular file
  buf.write('ustar  \0', 257, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return buf;
}

function findTarDataEnd(buf) {
  let offset = 0;
  let dataEnd = 0;
  while (offset + 512 <= buf.length) {
    let isZero = true;
    for (let i = offset; i < offset + 512; i++) {
      if (buf[i] !== 0) { isZero = false; break; }
    }
    if (isZero) break;
    const size = parseInt(buf.subarray(offset + 124, offset + 136).toString('ascii').replace(/\0/g, '').trim(), 8) || 0;
    offset += 512 + 512 * Math.ceil(size / 512);
    dataEnd = offset;
  }
  return dataEnd;
}

async function appendTarIndex(buf) {
  let tarBuf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    tarBuf = zlib.gunzipSync(buf);
  } else if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
    tarBuf = zlib.zstdDecompressSync(buf);
  } else {
    tarBuf = buf;
  }

  const metadata = await tarindex(Readable.from([tarBuf]));

  const jsonBuf = Buffer.from(JSON.stringify(metadata));
  const header = buildTarHeader('.vfs-index.json', jsonBuf.length);
  const paddedJson = Buffer.alloc(512 * Math.ceil(jsonBuf.length / 512));
  jsonBuf.copy(paddedJson);

  const dataEnd = findTarDataEnd(tarBuf);
  const jsonBlock = (dataEnd + 512) / 512;

  // 16-byte hint: magic "webR" | reserved | block | len  (all big-endian int32)
  const hint = Buffer.alloc(16);
  hint.writeInt32BE(2003133010, 0);
  hint.writeInt32BE(0, 4);
  hint.writeInt32BE(jsonBlock, 8);
  hint.writeInt32BE(jsonBuf.length, 12);

  const newTar = Buffer.concat([
    tarBuf.subarray(0, dataEnd),
    header,
    paddedJson,
    Buffer.alloc(1024), // end-of-archive
    hint,
  ]);

  return zlib.gzipSync(newTar);
}

const args = process.argv.slice(2);
const appendMode = args[0] === '--append';
if (appendMode) args.shift();

const [input, output] = args;

if (appendMode) {
  async function readInput() {
    if (input) return readFileSync(input);
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  readInput()
    .then(buf => appendTarIndex(buf))
    .then(result => {
      if (output) {
        writeFileSync(output, result);
      } else if (input) {
        writeFileSync(input, result); // overwrite in-place
      } else {
        process.stdout.write(result);
      }
    })
    .catch(err => {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    });
} else {
  const stream = input ? createReadStream(input) : process.stdin;

  tarindex(stream).then(function(result) {
    const json = JSON.stringify(result, null, 2);
    if (output) {
      writeFileSync(output, json);
    } else {
      process.stdout.write(json + '\n');
    }
  }).catch(function(err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  });
}
