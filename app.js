require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const fetch = require('node-fetch');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const app = express();
const port = 8888;

// Spotify API credentials from .env
const SPOTIPY_CLIENT_ID = process.env.SPOTIPY_CLIENT_ID;
const SPOTIPY_CLIENT_SECRET = process.env.SPOTIPY_CLIENT_SECRET;
const SPOTIPY_REDIRECT_URI = process.env.SPOTIPY_REDIRECT_URI;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIPY_CLIENT_ID,
  clientSecret: SPOTIPY_CLIENT_SECRET,
  redirectUri: SPOTIPY_REDIRECT_URI,
});

let currentTrackId = null;
let isAuthenticated = false;

// Function to read tokens from file
const readTokensFromFile = () => {
  try {
    const tokens = JSON.parse(fs.readFileSync('tokens.json'));
    if (tokens.access_token && tokens.refresh_token) {
      spotifyApi.setAccessToken(tokens.access_token);
      spotifyApi.setRefreshToken(tokens.refresh_token);
      console.log('Tokens loaded from file.');
      isAuthenticated = true;
    }
  } catch (error) {
    console.log('No token file found or invalid tokens.');
  }
};

// Function to write tokens to file
const writeTokensToFile = (accessToken, refreshToken) => {
  const tokens = { access_token: accessToken, refresh_token: refreshToken };
  fs.writeFileSync('tokens.json', JSON.stringify(tokens));
  console.log('Tokens saved to file.');
};

// Function to refresh the Spotify access token
const refreshAccessToken = async () => {
  try {
    const data = await spotifyApi.refreshAccessToken();
    const accessToken = data.body['access_token'];
    spotifyApi.setAccessToken(accessToken);
    writeTokensToFile(accessToken, spotifyApi.getRefreshToken());
    console.log('Access token refreshed');
  } catch (error) {
    console.error('Error refreshing access token:', error);
  }
};

// Function to format duration from milliseconds to "minutes:seconds"
const formatDuration = (durationMs) => {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

// Function to send track information to Discord
const sendTrackInfoToDiscord = async (track) => {
  try {
    const trackName = track.name;
    const artistName = track.artists && track.artists[0] ? track.artists[0].name : 'Unknown Artist';
    const albumName = track.album ? track.album.name : 'Unknown Album';
    const trackUrl = track.external_urls ? track.external_urls.spotify : 'No URL';
    const durationMs = track.duration_ms || 0; // Total duration in milliseconds
    const durationFormatted = formatDuration(durationMs); // Format duration to "minutes:seconds"

    // Prepare the Discord message
    const discordMessage = {
      content: `**Now Playing:**\n\n**Track:** ${trackName}\n**Artist:** ${artistName}\n**Album:** ${albumName}\n**Duration:** ${durationFormatted}\n[Listen on Spotify](${trackUrl})`,
    };

    // Send message to Discord
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordMessage),
    });
    console.log('Track info sent to Discord!');
  } catch (error) {
    console.error('Error sending track info to Discord:', error);
  }
};

// Function to check the currently playing track and send updates
const checkCurrentlyPlaying = async () => {
  try {
    if (!isAuthenticated) {
      console.log('User is not authenticated.');
      return;
    }
    // Fetch currently playing track
    const currentTrack = await spotifyApi.getMyCurrentPlayingTrack();
    if (currentTrack.body && currentTrack.body.item && currentTrack.body.item.id) {
      const track = currentTrack.body.item;

      // Check if the track has changed
      if (track.id !== currentTrackId) {
        currentTrackId = track.id;
        await sendTrackInfoToDiscord(track);
      }
    } else {
      console.log('No track is currently playing.');
    }
  } catch (error) {
    console.error('Error fetching track info:', error);
  }
};

// Poll for currently playing track every 10 seconds
setInterval(checkCurrentlyPlaying, 10 * 1000); // 10 seconds in milliseconds

// Refresh the access token every 45 minutes
setInterval(refreshAccessToken, 45 * 60 * 1000); // 45 minutes in milliseconds

// Route to initiate Spotify OAuth flow
app.get('/login', (req, res) => {
  const scopes = ['user-read-playback-state', 'user-read-currently-playing'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authorizeURL);
});

// Callback route for Spotify to redirect to
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (code) {
    try {
      const data = await spotifyApi.authorizationCodeGrant(code);
      const accessToken = data.body['access_token'];
      const refreshToken = data.body['refresh_token'];
      spotifyApi.setAccessToken(accessToken);
      spotifyApi.setRefreshToken(refreshToken);
      writeTokensToFile(accessToken, refreshToken);
      isAuthenticated = true;
      res.redirect('/track-info');
    } catch (error) {
      console.error('Error during Spotify authorization:', error);
      res.status(500).send('Error during Spotify authorization');
    }
  } else {
    res.status(400).send('No code provided');
  }
});

// Initial endpoint to ensure everything is set up
app.get('/track-info', (req, res) => {
  res.send('Polling for track info. Check the console for updates.');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  readTokensFromFile(); // Read tokens on startup
});
