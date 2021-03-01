const express = require('express')
const cors = require('cors')
const querystring = require('querystring')
const request = require('request')
const SpotifyWebApi = require('spotify-web-api-node')

const { writeFile, readFile } = require('fs')

module.exports = plugin => {
  let spotifyApiInitialized = false
  let spotifyApi

  let clientId
  let clientSecret

  let accessToken
  let refreshToken
  let tokenFile

  let app

  const log = (message) => plugin.nvim.outWriteLine(`[spotify.nvim]: ${message}`)
  const error = (message) => plugin.nvim.errWriteLine(`[spotify.nvim]: ${message}`)

  const initializeSpotify = async () => {
    if (spotifyApiInitialized) return
    if (!accessToken) await setupAndRunExpressApp()

    try {
      spotifyApi = new SpotifyWebApi()
      spotifyApi.setAccessToken(accessToken)
      spotifyApi.setRefreshToken(refreshToken)
      spotifyApiInitialized = true
      log('Spotify plugin initialized!')
    } catch (e) {
      log(`Error ocurred while initializing Spotify: "${e}".`)
    }
  }

  const registerCommand = (commandName, func) => plugin.registerCommand(commandName, async () => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with SpotifyInit(), doing that now')
      await initializeSpotify()
      await func()
    }
    await func()
  })

  const registerSyncFunc = (funcName, func) => plugin.registerFunction(funcName, async (...args) => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with SpotifyInit(), doing that now')
      await initializeSpotify()
      return await func.apply(null, ...args)
    }
    return await func.apply(null, ...args)
  }, { sync: true })


  const registerAsyncFunc = (funcName, func) => plugin.registerFunction(funcName, async (...args) => {
    if (!spotifyApiInitialized) {
      log('Need to initialize Spotify with SpotifyInit(), doing that now')
      await initializeSpotify()
      return await func.apply(null, ...args)
    }
    return await func.apply(null, ...args)
  }, { sync: false })

  const persistTokens = async () => {
    const str = JSON.stringify({
      accessToken,
      refreshToken,
    })

    await writeFile(tokenFile, str, (err) => {
      if (err) log(`Error writing Spotify tokens to ${tokenFile}: "${err}"`)
    })
  }

  const tryReadTokens = () => {
    readFile(tokenFile, (err, data) => {
      if (err) {
        log(`Token file does not exist at ${tokenFile}, will need to authenticate.`)
        return
      }

      const tokenFileText = JSON.parse(data.toString())
      accessToken = tokenFileText.accessToken
      refreshToken = tokenFileText.refreshToken
    })
  }

  function setupAndRunExpressApp() {
    return new Promise((resolve, reject) => {
      if (accessToken) reject('access token already gotten, don\'t think this should happen')
      if (!clientId || !clientSecret) {
        log('You need to call `SpotifyConfig` with your client_id and client_secret!')
        // TODO(smolck): return or no?
        reject('No client id or client secret')
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
            refreshToken = refresh_token

            resolve('initialized')
            persistTokens()

            res.redirect('/#' + querystring.stringify({ success: 'you now have a token!' }))

            } else {
              res.redirect('/#' +
                querystring.stringify({
                  error: 'invalid_token'
                }))
            }
          })
      })
      app.listen(8888)
    }).then((_) => app.close())
  }

  plugin.registerFunction('SpotifyConfig', ([{ client_id, client_secret, token_file }]) => {
    clientId = client_id
    clientSecret = client_secret

    // TODO(smolck): Good default, or is there better?
    tokenFile = token_file || (process.env.HOME ? process.env.HOME + '/.spotify_nvim_tokens.json' : '~/.spotify_nvim_tokens.json')
    tryReadTokens()
  }, { sync: false })

  plugin.registerFunction('SpotifyInit', async () => {
    if (!accessToken) {
      log('Please visit http://localhost:8888 and authenticate')
      setupExpressApp()
      return
    }
    if (spotifyApiInitialized) return
    await initializeSpotify()
  }, { sync: false })

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
