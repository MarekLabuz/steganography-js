const fs = require('fs')
const zlib = require('zlib')
const CRC32 = require('crc-32')
const yargs = require('yargs')

const {
  getChannelsHexLength,
  convertStringToMatrix,
  convertMatrixToString
} = require('./utils')

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

  return imageChunks
}

const processImageBeforeIDAT = imageChunks => imageChunks
  .filter(v => v.type !== 'IDAT' && v.type !== 'IEND')
  .reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))

function transformPixelData (pixel, channelsHexLength, [b1, b2, b3]) {
  let binary = parseInt(pixel, 16).toString(2).padStart(channelsHexLength * 4, '0')
  let [r, g, b, a] = [binary.slice(0, 8), binary.slice(8, 16), binary.slice(16, 24), binary.slice(24)]
  r = r.slice(0, -1) + b1
  g = g.slice(0, -1) + b2
  b = b.slice(0, -1) + b3
  binary = [r, g, b, a].join('')
  return parseInt(binary, 2).toString(16).padStart(channelsHexLength, '0')
}

function processImageIDAT (imageChunks, width, height, channelsHexLength, textBinaryGenerator) {
  let imageIDATData = imageChunks
    .filter(v => v.type === 'IDAT')
    .reduce((acc, v) => Buffer.concat([acc, v.data]), Buffer.from([]))

  imageIDATData = zlib.inflateSync(imageIDATData).toString('hex')

  const { matrix, filters } = convertStringToMatrix(imageIDATData, width, height, channelsHexLength)

  let done = false
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) {
      const bits = [textBinaryGenerator.next(), textBinaryGenerator.next(), textBinaryGenerator.next()]
      const b3 = bits[bits.length - 1]
      done = b3.done || b3.value === undefined
      if (done) {
        break
      }
      matrix[j][i] = transformPixelData(matrix[j][i], channelsHexLength, bits.map(v => v.value))
    }
    if (done) {
      break
    }
  }

  imageIDATData = convertMatrixToString(matrix, filters, channelsHexLength)

  imageIDATData = Buffer.from(imageIDATData, 'hex')

  imageIDATData = zlib.deflateSync(imageIDATData).toString('hex')

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
  }

  return idats.reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))
}

function * createReadableBinary (binaryText) {
  for (let i = 0; i < binaryText.length; i += 1) {
    const bin = parseInt(Buffer.from(binaryText.slice(i, i + 1), 'ascii').toString('hex'))
      .toString(2)
      .padStart(8, '0')
      .split('')

    while (bin.length) {
      yield bin.shift()
    }
  }
}

const processImageAfterIDAT = imageChunks => imageChunks
  .filter(v => v.type === 'IEND')
  .reduce((acc, v) => Buffer.concat([acc, v.chunk]), Buffer.from([]))

yargs // eslint-disable-line no-unused-expressions
  .command(
    'encrypt',
    'Encrypt text into image',
    {
      text: {
        alias: 't',
        required: true
      },
      image: {
        alias: 'i',
        required: true
      },
      output: {
        alias: 'o',
        default: 'output.png'
      }
    },
    (argv) => {
      const { text, image, output } = argv

      const textBits = Buffer.from(text, 'ascii').toString('hex')
      const textBitsLength = textBits.length
      const textBinaryGenerator = createReadableBinary(textBits)

      const imageHex = fs.readFileSync(image).toString('hex')
      const imageChunks = divideImageIntoChunks(imageHex)

      const IHDRdata = imageChunks[1].data.toString('hex')
      const width = parseInt(IHDRdata.slice(0, 8), 16)
      const height = parseInt(IHDRdata.slice(8, 16), 16)
      const colorType = parseInt(IHDRdata.slice(18, 20), 16)

      const bitsImageCapacity = width * height * 3

      if (bitsImageCapacity < textBitsLength) {
        console.error(`Too long text for your image. Number of characters ${textBitsLength / 8} exceeds the image capacity by ${Math.ceil((textBitsLength - bitsImageCapacity) / 8)} characters.`)
        process.exit(1)
      }

      const channelsHexLength = getChannelsHexLength(colorType)

      const imageBufferBeforeIDAT = processImageBeforeIDAT(imageChunks)
      const imageBufferIDAT = processImageIDAT(imageChunks, width, height, channelsHexLength, textBinaryGenerator)
      const imageBufferAfterIDAT = processImageAfterIDAT(imageChunks)

      const newImage = Buffer.concat([
        imageBufferBeforeIDAT,
        imageBufferIDAT,
        imageBufferAfterIDAT
      ])

      fs.writeFileSync(output, newImage)
    }
  )
  .help()
  .argv
