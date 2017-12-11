const fs = require('fs')
const yargs = require('yargs')

const {
  getChannelsHexLength,
  createReadableBinary,
  divideImageIntoChunks,
  processImageBeforeIDAT,
  processImageIDATEncrypt,
  processImageIDATDecrypt,
  processImageAfterIDAT
} = require('./utils')

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
    async (argv) => {
      const { text, image, output } = argv

      const textHex = Buffer.from(text, 'ascii').toString('hex')
      const textLengthInHex = text.length.toString(16).padStart(5, '0')
      const textHexLength = textHex.length

      const textBinaryGenerator = createReadableBinary(textLengthInHex + textHex)

      const imageHex = fs.readFileSync(image).toString('hex')
      console.log('\x1b[34mImage loaded ✓\x1b[0m')

      const imageChunks = divideImageIntoChunks(imageHex)

      const IHDRdata = imageChunks[1].data.toString('hex')
      const width = parseInt(IHDRdata.slice(0, 8), 16)
      const height = parseInt(IHDRdata.slice(8, 16), 16)
      const colorType = parseInt(IHDRdata.slice(18, 20), 16)

      const bitsImageCapacity = width * height * 3
      const textBitsLength = textLengthInHex.length * 4 + textHexLength * 4

      if (bitsImageCapacity < textBitsLength) {
        console.error(`Too long text for your image. Number of characters ${text.length} exceeds the image capacity by ${Math.ceil((textBitsLength - bitsImageCapacity) / 8)} characters.`)
        process.exit(1)
      }

      const channelsHexLength = getChannelsHexLength(colorType)

      const imageBufferBeforeIDAT = processImageBeforeIDAT(imageChunks)
      const imageBufferIDAT = processImageIDATEncrypt(imageChunks, width, height, channelsHexLength, textBinaryGenerator, textBitsLength)
      const imageBufferAfterIDAT = processImageAfterIDAT(imageChunks)

      const newImage = Buffer.concat([
        imageBufferBeforeIDAT,
        imageBufferIDAT,
        imageBufferAfterIDAT
      ])

      fs.writeFileSync(output, newImage)
    }
  )
  .command(
    'decrypt',
    'Decrypt image',
    {
      image: {
        alias: 'i',
        required: true
      }
    },
    (argv) => {
      const { image } = argv

      const imageHex = fs.readFileSync(image).toString('hex')
      const imageChunks = divideImageIntoChunks(imageHex)

      const IHDRdata = imageChunks[1].data.toString('hex')
      const width = parseInt(IHDRdata.slice(0, 8), 16)
      const height = parseInt(IHDRdata.slice(8, 16), 16)
      const colorType = parseInt(IHDRdata.slice(18, 20), 16)

      const channelsHexLength = getChannelsHexLength(colorType)

      const text = processImageIDATDecrypt(imageChunks, width, height, channelsHexLength)

      console.log(`\x1b[34mDecrypted message: \x1b[1m${text}\x1b[0m`)
    }
  )
  .help()
  .argv
