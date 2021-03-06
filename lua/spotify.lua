local spotify = {}

-- See https://github.com/tjdevries/rofl.nvim/blob/632c10f2ec7c56882a3f7eda8849904bcac6e8af/lua/rofl.lua
local binary_path = vim.fn.fnamemodify(
  api.nvim_get_runtime_file("lua/spotify.lua", false)[1], ":h:h")
  .. "/target/debug/spotify-nvim"

if vim.fn.executable(binary_path) == 0 then
  binary_path = vim.fn.fnamemodify(
    api.nvim_get_runtime_file("lua/rofl.lua", false)[1], ":h:h")
    .. "/target/release/spotify-nvim"
end

function spotify.request(method, ...)
  spotify.start()
  return vim.rpcrequest(spotify.job_id, method, ...)
end

function spotify.notify(method, ...)
  spotify.start()
  vim.rpcnotify(spotify.job_id, method, ...)
end

function spotify.play_track(track_uri)
  spotify.notify("play_track", track_uri)
end

function spotify.search_tracks(search)
  return spotify.request("search_tracks", search)
end

local os = require'os'
function spotify.config()
  spotify.notify("config", {
    client_id = os.getenv('SPO_CL_ID'),
    client_secret = os.getenv('SPO_CL_SEC'),
  })
end

function spotify.start()
  if spotify.job_id ~= nil then return end
  spotify.job_id = vim.fn.jobstart({ binary_path }, { rpc = true })
end

return spotify
