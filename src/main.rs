extern crate rspotify;

use rspotify::client::Spotify;
use rspotify::model::{page::Page, search::SearchResult};
use rspotify::oauth2::{SpotifyClientCredentials, SpotifyOAuth, TokenInfo};
use rspotify::senum::SearchType;
use rspotify::util::{generate_random_string, process_token};
// use rspotify::senum::Country;

use futures::lock::Mutex;
use std::sync::Arc;

use async_trait::async_trait;
use nvim_rs::{compat::tokio::Compat, create::tokio as create, Handler, Neovim};
use rmpv::Value;
use tokio::io::Stdout;

use tokio::fs;

#[derive(Clone)]
struct NeovimHandler {
    spotify: Arc<Mutex<Option<Spotify>>>,

    // (String, String) is (client_id, client_secret)
    creds: Arc<Mutex<Option<(String, String)>>>,
    token_file_path: Arc<Mutex<String>>,
}

async fn save_token_to_file(token: &TokenInfo, file_path: &str) -> Result<(), std::io::Error> {
    fs::write(file_path, serde_json::to_string(token).unwrap()).await
}

async fn read_token_from_file(file_path: &str) -> Result<TokenInfo, std::io::Error> {
    let string = fs::read_to_string(file_path).await?;
    let token = serde_json::from_str::<TokenInfo>(&string)?;
    Ok(token)
}

impl NeovimHandler {
    fn new() -> NeovimHandler {
        NeovimHandler {
            spotify: Arc::new(Mutex::new(None)),
            creds: Arc::new(Mutex::new(None)),
            token_file_path: Arc::new(Mutex::new(format!(
                "{}/.spotify_nvim_tokens",
                std::env::var("HOME").unwrap()
            ))),
        }
    }

    async fn try_init_spotify(&self, nvim: &Neovim<Compat<Stdout>>) -> Result<(), String> {
        let token_file_path = self.token_file_path.lock().await;
        if let Some(_spotify) = self.spotify.lock().await.as_ref() {
            return Ok(());
        }

        match read_token_from_file(&token_file_path).await {
            Ok(token_info) => {
                let initialized = Spotify::default()
                    .client_credentials_manager(
                        SpotifyClientCredentials::default()
                            .token_info(token_info)
                            .build(),
                    )
                    .build();

                let mut spotify = self.spotify.lock().await;
                *spotify = Some(initialized);

                nvim.out_write(&format!("[spotify-nvim]: Initialized spotify!\n"))
                    .await
                    .unwrap();

                return Ok(());
            }
            Err(err) => nvim
                .err_writeln(&format!("{}\n", err.to_string()))
                .await
                .unwrap(),
        }

        let creds = self.creds.lock().await;
        let id;
        let secret;
        match creds.as_ref() {
            Some((id_, sec_)) => {
                id = id_;
                secret = sec_;
            }
            None => {
                //nvim.err_writeln("[spotify-nvim]: Trying to initialize spotify without client credentials! Failing.").await.unwrap();
                return Err(String::from("[spotify-nvim]: Trying to initialize spotify without client credentials! Failing."));
            }
        }
        let mut oauth = SpotifyOAuth::default()
            .client_id(id)
            .client_secret(secret)
            // .client_id(&std::env::var("SPO_CL_ID").unwrap())
            // .client_secret(&std::env::var("SPO_CL_SEC").unwrap())
            .scope("user-modify-playback-state")
            .redirect_uri("http://localhost:8888/callback")
            .build();

        // TODO(smolck): Error handling properly
        let state = generate_random_string(16);
        let auth_url = oauth.get_authorize_url(Some(&state), None);
        let input = nvim
            .call_function(
                "input",
                vec![Value::from(format!(
                    "Go to {} and then paste the one you're redirected to: ",
                    auth_url
                ))],
            )
            .await
            .unwrap();
        let token_info = process_token(&mut oauth, &mut input.as_str().unwrap().to_owned())
            .await
            .unwrap();

        save_token_to_file(&token_info, &token_file_path)
            .await
            .unwrap();

        let initialized = Spotify::default()
            .client_credentials_manager(
                SpotifyClientCredentials::default()
                    .token_info(token_info)
                    .build(),
            )
            .build();

        let mut spotify = self.spotify.lock().await;
        *spotify = Some(initialized);

        nvim.out_write(&format!("[spotify-nvim]: Initialized spotify!\n"))
            .await
            .unwrap();

        Ok(())
    }
}

#[async_trait]
impl Handler for NeovimHandler {
    type Writer = Compat<Stdout>;

    async fn handle_notify(&self, name: String, args: Vec<Value>, neovim: Neovim<Compat<Stdout>>) {
        match name.as_ref() {
            //"init" => self.try_init_spotify(&neovim).await,
            "config" => {
                let map: &Vec<(Value, Value)> = args[0].as_map().unwrap();

                let mut client_id = None;
                let mut client_secret = None;
                let mut token_file_path = None;
                for (key, val) in map {
                    match key.as_str().unwrap() {
                        "client_secret" => client_secret = Some(val.as_str().unwrap()),
                        "client_id" => client_id = Some(val.as_str().unwrap()),
                        "token_file_path" => token_file_path = Some(val.as_str().unwrap()),
                        _ => {}
                    }
                }
                if client_id.is_none() || client_secret.is_none() {
                    neovim
                        .err_writeln(
                            "[spotify-nvim]: client_id and/or client_secret not passed to config",
                        )
                        .await
                        .unwrap();
                    return;
                }

                let mut creds = self.creds.lock().await;
                *creds = Some((
                    client_id.unwrap().to_owned(),
                    client_secret.unwrap().to_owned(),
                ));

                if let Some(path) = token_file_path {
                    let mut p = self.token_file_path.lock().await;
                    *p = path.to_owned();
                }
            }
            "play_track" => {
                self.try_init_spotify(&neovim).await.unwrap();
                let spotify = self.spotify.lock().await;
                match spotify.as_ref() {
                    Some(x) => {
                        x.start_playback(
                            None,
                            None,
                            Some(vec![args[0].as_str().unwrap().to_owned()]),
                            None,
                            None,
                        )
                        .await
                        .unwrap();
                    }
                    None => {}
                }
            }
            _ => {}
        }
    }

    async fn handle_request(
        &self,
        name: String,
        args: Vec<Value>,
        neovim: Neovim<Compat<Stdout>>,
    ) -> Result<Value, Value> {
        match name.as_ref() {
            "next_track" => {
                self.try_init_spotify(&neovim).await.unwrap();
                let spotify = self.spotify.lock().await;
                match spotify.as_ref() {
                    Some(x) => match x.next_track(None).await {
                        Ok(_) => {}
                        Err(err) => neovim
                            .err_writeln(&format!(
                                "[spotify-nvim]: Error going to next track: {}",
                                err
                            ))
                            .await
                            .unwrap(),
                    },
                    None => neovim
                        .err_writeln(
                            "[spotify-nvim]: Spotify not initialized, can't go to next track!",
                        )
                        .await
                        .unwrap(),
                }
                Ok(Value::Nil)
            }
            "search_tracks" => {
                self.try_init_spotify(&neovim).await.unwrap();
                let spotify = self.spotify.lock().await;
                match spotify.as_ref() {
                    Some(x) => {
                        let mut query = String::from("");
                        for (key, val) in args[0].as_map().unwrap() {
                            match key.as_str().unwrap() {
                                "artist" => {
                                    query.push_str(&format!("artist:{} ", val.as_str().unwrap()))
                                }
                                "track" => {
                                    query.push_str(&format!("track:{} ", val.as_str().unwrap()))
                                }
                                _ => {}
                            }
                        }

                        match x.search(&query, SearchType::Track, 50, 0, None, None).await {
                            Ok(resp) => match resp {
                                SearchResult::Tracks(Page { items, .. }) => {
                                    Ok(items
                                        .iter()
                                        .map(|x| {
                                            Value::from(vec![
                                                (
                                                    Value::from("name".to_owned()),
                                                    Value::from(x.name.clone()),
                                                ),
                                                (
                                                    Value::from("uri".to_owned()),
                                                    Value::from(x.uri.clone()),
                                                ),
                                            ])
                                        })
                                        .collect::<Value>())
                                    // neovim.out_write(&format!("{:?}\n", xs)).await.unwrap();
                                }
                                _ => Err(Value::from(String::from(
                                    "[spotify-nvim]: Couldn't get things!",
                                ))),
                            },
                            Err(err) => Err(Value::from(err.to_string())),
                        }
                    }
                    None => Err(Value::from("[spotify-nvim]: Umm . . .".to_owned())),
                }
            }
            _ => Ok(Value::Nil),
        }
    }
}

#[tokio::main]
async fn main() {
    let handler = NeovimHandler::new();
    let (nvim, io_handler) = create::new_parent(handler).await;
    match io_handler.await {
        Err(joinerr) => eprintln!("Error joining IO loop: '{}'", joinerr),
        Ok(Err(err)) => {
            if !err.is_reader_error() {
                // One last try, since there wasn't an error with writing to the
                // stream
                nvim.err_writeln(&format!("Error: '{}'", err))
                    .await
                    .unwrap_or_else(|e| {
                        // We could inspect this error to see what was happening, and
                        // maybe retry, but at this point it's probably best
                        // to assume the worst and print a friendly and
                        // supportive message to our users
                        eprintln!("Well, hmm... '{}'", e);
                    });
            }

            if !err.is_channel_closed() {
                // Closed channel usually means neovim quit itself, or this plugin was
                // told to quit by closing the channel, so it's not always an error
                // condition.
                eprintln!("Error: '{}'", err);

                /*let mut source = err.source();

                while let Some(e) = source {
                  eprintln!("Caused by: '{}'", e);
                  source = e.source();
                }*/
            }
        }
        Ok(Ok(())) => {}
    }
}
