var ResolvedTextDecoder = typeof window !== 'undefined' ? window.TextDecoder : TextDecoder;
var PolyfilledTextDecoder = typeof ResolvedTextDecoder !== 'undefined' ? ResolvedTextDecoder : function () {
  /**
   * @license TextDecoder polyfill
   * Copyright (c) 2013, Viktor Mukhachev. (CC0 1.0 License)
   * https://gist.github.com/Yaffle/5458286
   */function TextDecoderPolyfill() {}
  TextDecoderPolyfill.prototype.decode = function (octets) {
    var result = '';
    var octet;
    var bytesNeeded;
    var codePoint;
    var i = 0;
    while (i < octets.length) {
      octet = octets[i];
      bytesNeeded = 0;
      codePoint = 0;
      if (octet <= 0x7F) {
        bytesNeeded = 0;
        codePoint = octet & 0xFF;
      } else if (octet <= 0xDF) {
        bytesNeeded = 1;
        codePoint = octet & 0x1F;
      } else if (octet <= 0xEF) {
        bytesNeeded = 2;
        codePoint = octet & 0x0F;
      } else if (octet <= 0xF4) {
        bytesNeeded = 3;
        codePoint = octet & 0x07;
      }
      if (octets.length - i - bytesNeeded > 0) {
        var k = 0;
        while (k < bytesNeeded) {
          octet = octets[i + k + 1];
          codePoint = codePoint << 6 | octet & 0x3F;
          k += 1;
        }
      } else {
        codePoint = 0xFFFD;
        bytesNeeded = octets.length - i;
      }
      result += String.fromCodePoint(codePoint);
      i += bytesNeeded + 1;
    }
    return result;
  };
  return TextDecoderPolyfill;
}();
var createBytesBuffer = typeof Uint8Array !== 'undefined' ? function (bytes) {
  return new Uint8Array(bytes);
} : function (bytes) {
  return Buffer.from(bytes);
};
var dt = function dt(hex) {
  var prev = '';
  var _byte;
  var bytes = [];
  for (var i = 0; i < hex.length; i++) {
    if (i & 1 && prev) {
      _byte = parseInt(prev + hex[i], 16);
      if (isNaN(_byte)) {
        throw new Error('badWordsNext: incorrect hex string supplied as a dictionary');
      }
      bytes.push(_byte);
      prev = '';
    } else {
      prev += hex[i];
    }
  }
  return new PolyfilledTextDecoder().decode(createBytesBuffer(bytes));
};
var dd = function dd(hex) {
  var json = dt(hex);
  var obj;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    throw new Error('badWordsNext: dictionary hex string does not contain json object');
  }
  return obj;
};

export { dd, dt };
