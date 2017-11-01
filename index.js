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
      const imageBufferIDAT = processImageIDATEncrypt(imageChunks, width, height, channelsHexLength, textBinaryGenerator)
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

yargs // eslint-disable-line no-unused-expressions
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

      const bitsImageCapacity = width * height * 3

      const channelsHexLength = getChannelsHexLength(colorType)

      const text = processImageIDATDecrypt(imageChunks, width, height, channelsHexLength)

      console.log('To')
    }
  )
  .help()
  .argv
