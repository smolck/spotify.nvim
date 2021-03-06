local previewers = require'telescope.previewers'
local conf = require('telescope.config').values
local pickers = require'telescope.pickers'
local finders = require'telescope.finders'

local action_set = require('telescope.actions.set')
local action_state = require('telescope.actions.state')
local actions = require('telescope.actions')

local spotify = require'spotify'

local M = {}

function M.select_song(opts)
  opts = opts or {}

  local function create_finder(artist, track)
    if (artist == nil or artist == '') and (track == nil or track == '') then
      return finders.new_table {}
    end

    local tracks = spotify.search_tracks({
      artist = artist,
      track = track
    })

    return finders.new_table {
      results = tracks,
      entry_maker = function(track)
        return {
          value = track.uri,
          display = track.name,
          ordinal = track.name
        }
      end
    }
  end

  local timer = vim.loop.new_timer()
  local first = true
  local refresh = true

  local x = pickers.new(opts, {
    prompt_title = 'Spotify',
    finder = finders.new_table {},
    on_input_filter_cb = function(query_text)
      local refresh_copy = refresh
      if first then
        timer:start(500, 500, function() refresh = true end)
      else
        timer:again()
      end
      refresh = false

      local artist
      local track
      if refresh_copy then
        local split = vim.split(query_text, ',')
        artist = split[1]
        track = split[2]
      end

      return {
        prompt = query_text,
        updated_finder = refresh_copy and create_finder(artist, track) or nil
      }
    end,
    sorter = conf.generic_sorter{},
    attach_mappings = function(prompt_bufnr)
      actions.select_default:replace(function()
        local entry = action_state:get_selected_entry()
        spotify.play_track(entry.value)

        actions.close(prompt_bufnr)
      end)

      actions.close:enhance {
        post = function()
          timer:close()
        end
      }

      return true
    end
  }):find()
end

return M
