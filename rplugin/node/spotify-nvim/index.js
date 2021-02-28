const express = require('express')
const cors = require('cors')
const querystring = require('querystring')
const request = require('request')
const SpotifyWebApi = require('spotify-web-api-node')

const { readFileSync, writeFileSync } = require('fs')

module.exports = plugin => {
  let spotifyApiInitialized = false
  let spotifyApi

  const log = (message) => plugin.nvim.outWriteLine(message)
  const error = (message) => plugin.nvim.errWriteLine(message)

  const registerCommand = (commandName, func) => plugin.registerCommand(commandName, async () => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with :SpotifyInit')
      return
    }
    await func()
  })

  const registerSyncFunc = (funcName, func) => plugin.registerFunction(funcName, async (...args) => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with :SpotifyInit')
      // TODO(smolck): Return undefined instead? Still need to read up on
      // undefined vs. null in JS . . .
      return null
    }
    return await func.apply(null, ...args)
  }, { sync: true })


  const registerAsyncFunc = (funcName, func) => plugin.registerFunction(funcName, async (...args) => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with :SpotifyInit')
      // TODO(smolck): Return undefined instead? Still need to read up on
      // undefined vs. null in JS . . .
      return null
    }
    return await func.apply(null, ...args)
  }, { sync: false })

  let clientId
  let clientSecret

  let accessToken

  // TODO(smolck): This is just for testing, and needs to be changed to
  // (a) use the refresh token as well, and (b) read from a user-specified
  // location? And maybe not write this to a text file?
  try {
    const text = readFileSync('./token.txt').toString()
    if (text != '' || text != '\n') accessToken = text
  } catch (_e) {}

  let app
  const setupExpressApp = () => {
    if (accessToken) return
    if (!clientId || !clientSecret) {
      log('You need to call `SpotifyConfig` with your client_id and client_secret!')
      // TODO(smolck): return or no?
      return
    }

    app = express()
    app
      .use(express.static(__dirname + '/public'))
      // .use(cors())

    app.get('/login', (req, res) => {
      // your application requests authorization
      const scope = [
        'user-modify-playback-state',
      ].join(' ');
      res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: 'http://localhost:8888/callback',
      }))
    })

    app.get('/callback', (req, res) => {
        const authOptions = {
          url: 'https://accounts.spotify.com/api/token',
          form: {
            code: req.query.code,
            redirect_uri: 'http://localhost:8888/callback',
            grant_type: 'authorization_code'
          },
          headers: {
            'Authorization': 'Basic ' + (new Buffer(clientId + ':' + clientSecret).toString('base64'))
          },
          json: true
        }

        request.post(authOptions, (error, response, body) => {
          if (!error && response.statusCode === 200) {

          const access_token = body.access_token,
              refresh_token = body.refresh_token;

          accessToken = access_token

          // TODO(smolck): See TODO from above (lines 50-52) regarding reading this file
          writeFileSync('token.txt', accessToken)
          log('wrote to token.txt and now have a token')

          res.redirect('/#' + querystring.stringify({ success: 'it worked dude!' }))

          } else {
            res.redirect('/#' +
              querystring.stringify({
                error: 'invalid_token'
              }))
          }
        })
    })
    app.listen(8888)
  }

  plugin.registerFunction('SpotifyConfig', ({ client_id, client_secret }) => {
    clientId = client_id
    clientSecret = client_secret
  }, { sync: true })

  plugin.registerCommand('SpotifyInit', async () => {
    if (!accessToken) {
      log('Please visit http://localhost:8888 and authenticate, then call this command again')
      setupExpressApp()
      return
    }
    if (spotifyApiInitialized) return

    log('Initializing Spotify plugin')

    try {
      spotifyApi = new SpotifyWebApi()
      spotifyApi.setAccessToken(accessToken)
      spotifyApiInitialized = true
      await app.close()

      log('Spotify plugin initialized')
    } catch (e) {
      // Don't care about error's with closing the express app, probably
      // (definitely?) means it wasn't ever created since the token file
      // existed.
      if (!e.contains('app')) log(`Error ocurred while initializing Spotify: "${e}".`)
    }
  })

  registerCommand('SpotifyNextTrack', async() => {
    log('Going to next track')
    try {
      await spotifyApi.skipToNext()
    } catch (e) {
      log(`Error going to next track: "${e}"`)
    }
  })

  registerCommand('SpotifyPreviousTrack', async () => {
    log('Going to previous track')
    try {
      await spotifyApi.skipToPrevious()
    } catch (e) {
      log(`Error going to previous track: ${e}`)
    }
  })

  registerSyncFunc('SpotifySearchTracks', async ({
    artist,
    track,
  }) => {
    let query = ''
    try {
      if (artist) query += `artist:${artist} ` 
      if (track) query += `track:${track} `

      if (query == '') {
        error(`No query passed to SpotifySearchTracks`)
        return
      }

      // TODO(smolck)
      return (await spotifyApi.searchTracks(query)).body.tracks.items
    } catch (e) {
      error(`Error searching for "${query}": "${e}"`)
    }
  })

  registerAsyncFunc('SpotifyPlay', async (uriOrUris) => {
    let uris = Array.isArray(uriOrUris) ? uriOrUris : [uriOrUris]
    try {
      await spotifyApi.play({ uris })
    } catch (e) {
      error(`Error playing "${JSON.stringify(uris)}": "${e}"`)
    }
  })
}
