import {pipeline} from 'node:stream/promises';
import zlib from 'node:zlib';
import tar from 'tar-stream';
import {fileTypeStream} from 'file-type';

function index_tar_stream(input) {
  let files = [];
  function process_entry(header, stream, next_entry) {
    stream.on('end', next_entry);
    if (header.size > 0 && header.name.match(/\/.*/)) {
      files.push({
        filename: header.name,
        start: extract._buffer.shifted,
        end: extract._buffer.shifted + header.size
      });
    }
    stream.resume();
  }

  const extract = tar.extract({allowUnknownFormat: true}).on('entry', process_entry);
  return pipeline(input, extract).catch(function(err) {
    if (files.length > 0 && err.message.includes('Unexpected end')) {
      return true; // workaround tar-stream error not liking our 'hint'
    } else {
      throw new Error(err);
    }
  }).then(function() {
    return {files: files, remote_package_size: extract._buffer.shifted};
  });
}

export default function tarindex(input) {
  return fileTypeStream(input).then(function(x) {
    const mime = x.fileType ? x.fileType.mime : undefined;

    if (mime === 'application/gzip') {
      return index_tar_stream(x.pipe(zlib.createGunzip()));
    }

    if (mime === 'application/zstd') {
      return index_tar_stream(x.pipe(zlib.createZstdDecompress()));
    }

    // Plain tar or unknown — attempt directly
    return index_tar_stream(x);
  });
}
