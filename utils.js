const zlib = require('zlib')
const CRC32 = require('crc-32')
const log = require('single-line-log').stdout

const progressBar = (title, counter, overall, unit = 'bytes', incBy = 1, n = 25) => {
  counter += incBy
  const percentage = Math.floor(100 * (counter / overall))
  const numberOfBoxes = Math.floor(percentage / (100 / n))
  log(`\x1b[34m${title.padEnd(27, ' ')}[${Array(numberOfBoxes).fill('█').join('').padEnd(n, '-')}] ${counter}/${overall} ${unit} (${percentage}%)\x1b[0m`)
  return counter
}

const mod = (x, n = 256) => ((x % n) + n) % n

const parseHex = string => parseInt(string, 16)

const toHex = (int, pL) => {
  return mod(int).toString(16).padStart(2, '0')
}

function last (arr) {
  return arr[arr.length - 1]
}

function PaethPredictor (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  } else if (pb <= pc) {
    return b
  } else {
    return c
  }
}

const w = (channelsHexLength, fn, ...rgbs) => {
  const r = rgbs.map(rgb => rgb ? rgb.slice(0, 2) : '00')
  const fR = fn(...r)

  const g = rgbs.map(rgb => rgb ? rgb.slice(2, 4) : '00')
  const fG = fn(...g)

  const b = rgbs.map(rgb => rgb ? rgb.slice(4, 6) : '00')
  const fB = fn(...b)

  switch (channelsHexLength) {
    case 8: {
      const a = rgbs.map(rgb => rgb ? rgb.slice(6, 8) : '00')
      const fA = fn(...a)

      return fR + fG + fB + fA
    }
    default:
    case 6: {
      return fR + fG + fB
    }
  }
}

const getChannelsHexLength = (colorType) => {
  switch (colorType) {
    case 6:
      return 8
    case 2:
      return 6
    default:
      console.error('Image with such color type is not supported. Supported color types: 2, 6.')
      process.exit(0)
  }
}

const filtersMethods = {
  '00': (matrix, r, c, channelsHexLength) => w(channelsHexLength, v => toHex(parseHex(v)), matrix[r][c]),
  '01': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2) => toHex(parseHex(v1) + (rev ? 1 : -1) * parseHex(v2)), matrix[r][c], matrix[r][c - 1]),
  '02': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2) => toHex(parseHex(v1) + (rev ? 1 : -1) * parseHex(v2)), matrix[r][c], matrix[r - 1][c]),
  '03': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2, v3) => toHex(parseHex(v1) + (rev ? 1 : -1) * Math.floor((parseHex(v2) + parseHex(v3)) / 2)), matrix[r][c], matrix[r][c - 1], matrix[r - 1][c]),
  '04': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2, v3, v4) => toHex(parseHex(v1) + (rev ? 1 : -1) * PaethPredictor(parseHex(v2), parseHex(v3), parseHex(v4))), matrix[r][c], matrix[r][c - 1], matrix[r - 1][c], matrix[r - 1][c - 1])
}

const convertStringToMatrix = (string, width, height, channelsHexLength) => {
  const rowLength = 2 + width * channelsHexLength
  const matrix = []
  const filters = []
  let counter = 0
  for (let i = 0; i < string.length; i += rowLength) {
    const row = string.slice(i, i + rowLength)
    const [filterMethod, pixels] = [row.slice(0, 2), row.slice(2)]
    const rowArray = []
    for (let j = 0; j < pixels.length; j += channelsHexLength) {
      rowArray.push(pixels.slice(j, j + channelsHexLength))
      counter = progressBar('IDAT Bytes to matrix:', counter, string.length / rowLength * pixels.length / channelsHexLength, 'bytes')
    }
    filters.push(filterMethod)
    matrix.push(rowArray)
  }

  console.log()
  counter = 0
  const overallLength = matrix.length * matrix[0].length
  matrix.forEach((row, r) => {
    const filter = filtersMethods[filters[r]]
    row.forEach((column, c) => {
      matrix[r][c] = filter(matrix, r, c, channelsHexLength, true)
      counter = progressBar('Defiltering image:', counter, overallLength, 'bytes')
    })
  })
  return { matrix, filters }
}

const convertMatrixToString = (matrix, filters, channelsHexLength) => {
  console.log()
  let string = ''
  let counter = 0
  const filteredMatrix = matrix
    .map((row, r) => {
      const filter = filtersMethods[filters[r]]
      const newRow = row.map((columns, c) => {
        counter = progressBar('Matrix to IDAT bytes:', counter, matrix.length * row.length, 'bytes')
        return filter(matrix, r, c, channelsHexLength)
      })
      return newRow
    })

  console.log()
  counter = 0
  filteredMatrix.forEach((row, r) => {
    string += filters[r] + row.join('')
    counter = progressBar('IDAT bytes concatenation:', counter, filteredMatrix.length, 'rows')
  })

  return string
}

function divideImageIntoChunks (imageHex) {
  const pngBuffer = Buffer.from(imageHex.slice(0, 16), 'hex')
  const imageChunks = [{
    type: 'PNG',
    chunk: pngBuffer
  }]

  if (pngBuffer.toString('ascii').replace(/\W/g, '') !== 'PNG') {
    console.error('The file in not a PNG image.')
    process.exit(1)
  }

  for (let i = 16; i < imageHex.length;) {
    const hex = {}
    hex.length = imageHex.slice(i, i + 8)
    const length = parseInt(hex.length, 16)
    hex.type = imageHex.slice(i + 8, i + 16)
    const type = Buffer.from(hex.type, 'hex').toString('ascii')
    hex.data = imageHex.slice(i + 16, i + 16 + 2 * length)
    const data = Buffer.from(hex.data, 'hex')
    hex.crc = imageHex.slice(i + 16 + 2 * length, i + 16 + 2 * length + 8)
    const crc = hex.crc

    const chunk = Buffer.from(imageHex.slice(i, i + 16 + 2 * length + 8), 'hex')
    imageChunks.push({ chunk, length, type, data, crc, hex })

    i += 16 + 2 * length + 8
  }

  console.log(`\x1b[34mImage structure analysed: ${imageChunks.length} chunks ✓\x1b[0m`)

  return imageChunks
}

const processImageBeforeIDAT = imageChunks => imageChunks
  .filter(v => v.type !== 'IDAT' && v.type !== 'IEND')
  .reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))

function transformPixelData (pixel, channelsHexLength, [b1, b2, b3]) {
  let binary = parseInt(pixel, 16).toString(2).padStart(channelsHexLength * 4, '0')
  let [r, g, b, a] = [binary.slice(0, 8), binary.slice(8, 16), binary.slice(16, 24), binary.slice(24)]
  r = r.slice(0, -1) + (b1 || last(r))
  g = g.slice(0, -1) + (b2 || last(g))
  b = b.slice(0, -1) + (b3 || last(b))
  binary = [r, g, b, a].join('')
  return parseInt(binary, 2).toString(16).padStart(channelsHexLength, '0')
}

function processImageIDATEncrypt (imageChunks, width, height, channelsHexLength, textBinaryGenerator, textBitsLength) {
  let imageIDATData = imageChunks
    .filter(v => v.type === 'IDAT')
    .reduce((acc, v) => Buffer.concat([acc, v.data]), Buffer.from([]))

  imageIDATData = zlib.inflateSync(imageIDATData).toString('hex')

  const { matrix, filters } = convertStringToMatrix(imageIDATData, width, height, channelsHexLength)

  console.log()
  let counter = 0
  let done = false
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) {
      const bits = [textBinaryGenerator.next(), textBinaryGenerator.next(), textBinaryGenerator.next()]
      const b3 = bits[bits.length - 1]
      done = b3.done || b3.value === undefined

      matrix[j][i] = transformPixelData(matrix[j][i], channelsHexLength, bits.map(v => v.value))
      counter = progressBar('Text insertion:', counter, textBitsLength, 'bits', bits.filter(v => v.value).length)

      if (done) {
        break
      }
    }
    if (done) {
      break
    }
  }

  imageIDATData = convertMatrixToString(matrix, filters, channelsHexLength)

  imageIDATData = Buffer.from(imageIDATData, 'hex')

  imageIDATData = zlib.deflateSync(imageIDATData).toString('hex')

  console.log()
  counter = 0
  const idats = []
  let i = 0
  const bytes = imageIDATData.length / 2
  while (i < bytes) {
    const idat = {}
    const type = Buffer.from('IDAT', 'ascii').toString('hex').padStart(8, '0')
    const length = bytes - i > 16384 ? 16384 : bytes - i

    const data = imageIDATData.slice(i * 2, (i + length) * 2)

    const dataBuffer = Buffer.from(data, 'hex')
    const typeBuffer = Buffer.from(type, 'hex')
    const concatBuffer = Buffer.concat([typeBuffer, dataBuffer])
    const crc = (CRC32.buf(concatBuffer) >>> 32).toString(16).padStart(8, '0')

    idat.chunk = Buffer.from(length.toString(16).padStart(8, '0') + type + data + crc, 'hex')

    i += length

    idats.push(idat)
    counter = progressBar('Chunks concatenation:', counter, bytes, 'bytes', length)
  }

  console.log()
  return idats.reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))
}

function * createReadableBinary (textHex) {
  for (let i = 0; i < textHex.length; i += 1) {
    const bin = parseInt(textHex[i], 16)
      .toString(2)
      .padStart(4, '0')
      .split('')

    while (bin.length) {
      yield bin.shift()
    }
  }
}

const processImageAfterIDAT = imageChunks => imageChunks
  .filter(v => v.type === 'IEND')
  .reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))

function processImageIDATDecrypt (imageChunks, width, height, channelsHexLength) {
  let imageIDATData = imageChunks
    .filter(v => v.type === 'IDAT')
    .reduce((acc, v) => Buffer.concat([acc, v.data]), Buffer.from([]))

  imageIDATData = zlib.inflateSync(imageIDATData).toString('hex')

  const { matrix } = convertStringToMatrix(imageIDATData, width, height, channelsHexLength)

  let done = false
  let textBinary = ''

  let bitesToRead = 20
  let textLengthRead = false

  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) {
      const binary = matrix[j][i]
      let [r, g, b] = [binary.slice(0, 2), binary.slice(2, 4), binary.slice(4, 6)].map(v => parseInt(v, 16).toString(2).padStart(8, '0'))

      textBinary += r[7]
      bitesToRead -= 1

      textBinary += g[7]
      bitesToRead -= 1
      if (bitesToRead === 0 && !textLengthRead) {
        textLengthRead = true
        bitesToRead += parseInt(textBinary, 2) * 8
      }

      textBinary += b[7]
      bitesToRead -= 1

      if (bitesToRead <= 0) {
        done = true
      }
      if (done) {
        break
      }
    }
    if (done) {
      break
    }
  }

  console.log()
  console.log(`\x1b[34mText read ✓\x1b[0m`)

  textBinary = textBinary.slice(20)
  let t = ''
  for (let i = 0; i < textBinary.length; i += 8) {
    t += String.fromCharCode(parseInt(textBinary.slice(i, i + 8), 2))
  }

  return t
}

module.exports = {
  getChannelsHexLength,
  createReadableBinary,
  divideImageIntoChunks,
  processImageBeforeIDAT,
  processImageIDATEncrypt,
  processImageIDATDecrypt,
  processImageAfterIDAT
}
