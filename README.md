# tar-vfs-index

Generates a file index with raw offsets of a tarball, using the same format as [emscripten file packager](https://emscripten.org/docs/porting/files/packaging_files.html#packaging-using-the-file-packager-tool). This this metadata can be used to mount the tar blob in Emscripten's [WORKERFS](https://emscripten.org/docs/api_reference/Filesystem-API.html#id2) virtual filesystem without extracting it.

## Installation

```sh
npm install tar-vfs-index
```

## Command line

```sh
npx tar-vfs-index archive.tar.gz
npx tar-vfs-index archive.tar.zst [output.json]
npx tar-vfs-index --append archive.tar.gz
```

If no input file is given, stdin is used:

```sh
curl -sSL https://cran.r-project.org/src/contrib/Archive/jose/jose_1.0.tar.gz | npx tar-vfs-index
```

Output is written to stdout, or to a file if two arguments are given:

```json
{
  "files": [
    { "filename": "mypackage/DESCRIPTION", "start": 512, "end": 548 },
    { "filename": "mypackage/R/code.R", "start": 1536, "end": 1563 }
  ],
  "remote_package_size": 3072
}
```

## JavaScript API

```js
import tarindex from 'tar-vfs-index';
import { createReadStream } from 'node:fs';

const result = await tarindex(createReadStream('archive.tar.gz'));
console.log(result.files);
// [
//   { filename: 'mypackage/DESCRIPTION', start: 512, end: 548 },
//   { filename: 'mypackage/R/code.R', start: 1536, end: 1563 },
// ]
console.log(result.remote_package_size); // total bytes consumed
```

The `start` and `end` values are byte offsets within the **decompressed** tar stream.


## Use with Emscripten WORKERFS

Emscripten's [WORKERFS](https://emscripten.org/docs/api_reference/Filesystem-API.html#id2) filesystem lets you mount a vfs image inside a web worker, giving compiled C/C++ code read-only access to its files without copying. Mounting an image requires a `metadata` JSON object (normally produced by `file_packager --separate-metadata`) alongside a `Blob` of the raw archive data.

`tar-vfs-index` generates this metadata object for a tar archive. Note that if your tar file is gzipped (`tar.gz`) you should use the browser-native [DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) to get the blob of the uncompressed tarball.


```js
const [metaRes, dataRes] = await Promise.all([
  fetch('archive.tar.gz.json'),  // output of tar-vfs-index
  fetch('archive.tar.gz'),
]);
const metadata = await metaRes.json();

// WORKERFS slices the blob using the offsets in metadata, which refer to
// positions in the decompressed tar stream, so decompress before mounting.
const blob = await new Response(
  dataRes.body.pipeThrough(new DecompressionStream('gzip'))
).blob();

FS.mkdir('/pkg');
FS.mount(WORKERFS, { packages: [{ metadata, blob }] }, '/pkg');
```

## Embedding the index in the archive itself

The `--append` flag embeds the index directly into the archive as a `.vfs-index.json` entry, followed by a 16-byte lookup hint. This produces a self-contained `.tar.gz` that can be mounted by [webR](https://docs.r-wasm.org/webr/latest/) without a separate metadata file (as described in [tar-metadata](https://r-wasm.github.io/rwasm/articles/tar-metadata.html)):

```sh
npx tar-vfs-index --append archive.tar.gz          # modifies the file in-place
```