/* eslint-disable */
'use strict';

var codes, keys;

codes = {

  'ESCAPE'          : [0x01],
  '1'               : [0x02],
  '2'               : [0x03],
  '3'               : [0x04],
  '4'               : [0x05],
  '5'               : [0x06],
  '6'               : [0x07],
  '7'               : [0x08],
  '8'               : [0x09],
  '9'               : [0x0A],
  '0'               : [0x0B],
  '-'               : [0x0C],
  '='               : [0x0D],
  'BACKSPACE'       : [0x0E],
  'TAB'             : [0x0F],

  'Q'               : [0x10],
  'W'               : [0x11],
  'E'               : [0x12],
  'R'               : [0x13],
  'T'               : [0x14],
  'Y'               : [0x15],
  'U'               : [0x16],
  'I'               : [0x17],
  'O'               : [0x18],
  'P'               : [0x19],
  '['               : [0x1A],
  ']'               : [0x1B],
  'ENTER'           : [0x1C],
  'CTRL'            : [0x1D],
  'A'               : [0x1E],
  'S'               : [0x1F],

  'D'               : [0x20],
  'F'               : [0x21],
  'G'               : [0x22],
  'H'               : [0x23],
  'J'               : [0x24],
  'K'               : [0x25],
  'L'               : [0x26],
  ';'               : [0x27],
  '\''              : [0x28],
  'BACKQUOTE'       : [0x29],
  'SHIFT'           : [0x2A],
  '\\'              : [0x2B],
  'Z'               : [0x2C],
  'X'               : [0x2D],
  'C'               : [0x2E],
  'V'               : [0x2F],

  'B'               : [0x30],
  'N'               : [0x31],
  'M'               : [0x32],
  ','               : [0x33],
  '.'               : [0x34],
  '/'               : [0x35],
  'R_SHIFT'         : [0x36],
  'PRT_SC'          : [0x37],
  'ALT'             : [0x38],
  ' '               : [0x39],
  'CAPS_LOCK'       : [0x3A],
  'F1'              : [0x3B],
  'F2'              : [0x3C],
  'F3'              : [0x3D],
  'F4'              : [0x3E],
  'F5'              : [0x3F],

  'F6'              : [0x40],
  'F7'              : [0x41],
  'F8'              : [0x42],
  'F9'              : [0x43],
  'F10'             : [0x44],
  'NUM_LOCK'        : [0x45], // May be [0x45, 0xC5],
  'SCROLL_LOCK'     : [0x46],
  'NUMPAD_7'        : [0x47],
  'NUMPAD_8'        : [0x48],
  'NUMPAD_9'        : [0x49],
  'NUMPAD_SUBTRACT' : [0x4A],
  'NUMPAD_4'        : [0x4B],
  'NUMPAD_5'        : [0x4C],
  'NUMPAD_6'        : [0x4D],
  'NUMPAD_ADD'      : [0x4E],
  'NUMPAD_1'        : [0x4F],

  'NUMPAD_2'        : [0x50],
  'NUMPAD_3'        : [0x51],
  'NUMPAD_0'        : [0x52],
  'NUMPAD_DECIMAL'  : [0x53],
  'F11'             : [0x57],
  'F12'             : [0x58],

  // Same as other Enter key
  // 'NUMBER_Enter'    : [0xE0, 0x1C],
  'R_CTRL'          : [0xE0, 0x1D],

  'NUMBER_DIVIDE'   : [0xE0, 0x35],
  //
  // 'NUMBER_*'        : [0xE0, 0x37],
  'R_ALT'           : [0xE0, 0x38],

  'HOME'            : [0xE0, 0x47],
  'UP'              : [0xE0, 0x48],
  'PAGE_UP'         : [0xE0, 0x49],
  'LEFT'            : [0xE0, 0x4B],
  'RIGHT'           : [0xE0, 0x4D],
  'END'             : [0xE0, 0x4F],

  'DOWN'            : [0xE0, 0x50],
  'PAGE_DOWN'       : [0xE0, 0x51],
  'INSERT'          : [0xE0, 0x52],
  'DELETE'          : [0xE0, 0x53],
  'WINDOW'          : [0xE0, 0x5B],
  'R_WINDOW'        : [0xE0, 0x5C],
  'MENU'            : [0xE0, 0x5D],

  'PAUSE'           : [0xE1, 0x1D, 0x45, 0xE1, 0x9D, 0xC5]
};

codes.getBreakCode = function(key) {
  var makeCode = codes[key],
    breakCode;
  if (makeCode === undefined) {
    throw new Error('Undefined key: ' + key);
  }

  if (key === 'PAUSE') {
    return [];
  }

  if (makeCode[0] === 0xE0) {
    return [ 0xE0, makeCode[1] + 0x80 ];
  } else {
    return [ makeCode[0] + 0x80 ];
  }
};

module.exports = codes;


