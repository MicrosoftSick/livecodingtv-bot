'use strict';

/*
	Song commands:

	!upcoming - List next 5 songs
	!song/!track/!music - current song
	!request URL - request a youtube link to be played
	!skip - skips the track
	!pause - pauses the track
	!play - plays the current track in the play list
 */
const YouTube = require('youtube-node');
const Log = require('../utils/Log');
const websocket = require('../websocket');
const requestSongRegex = new RegExp( /^(!|\/)request\s(.+)$/ );

module.exports = [{
	// Reset current song index and playing boolean
    types: ['startup'],
    action: function( chat ) {
		let player = getPlayer( chat );
		player.currentSongIndex = 0;
		player.playing = false;
		player.started = false;
		setPlayer( player, chat );
    }
}, {
	// Skips to the next song when the player is finished playing a song
    types: ['websocket'],
	regex: /^songEnded$/,
    action: function( chat, messageObj ) {
		skipSong( chat );
    }
}, {
	// Tell the chat what the current song is
    types: ['message'],
    regex: /^(!|\/)(song|track|music)$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let playlist = getPlaylist( chat );

		if ( player.started && player.playing && playlist.length > 0 ) {
			// Player is playing a song
			let currentSong = playlist[ player.currentSongIndex ];
			chat.sendMessage( `Current song: ${currentSong.title}`)
		} else {
			// Player is paused or playlist is empty
			chat.sendMessage( 'No song current playing.' );
		}
    }
}, {
	// Request a song
	// TODO: validate this is a real URL
	// youtubeID regex: /(youtu(?:\.be|be\.com)\/(?:.*v(?:\/|=)|(?:.*\/)?)([\w'-]+))/i;
    types: ['message'],
    regex: requestSongRegex,
    action: function( chat, stanza ) {
		let match = requestSongRegex.exec( stanza.message );
		let youtubeID = match[2];

		// Look up the song information
		let youtube = getYoutubeClient( chat );
		youtube.getById( youtubeID, function(err, result) {
			if ( err ) {
				console.log( 'Error requesting youtube data:', err );
				return;
			}

			if ( result.items.length === 0 ) {
				chat.replyTo( stanza.fromUsername, 'Your song could not be found.' );
				return;
			}

			let videoObj = result.items[0].snippet;
			let playlist = getPlaylist( chat );
			let songObj = {
				youtubeID: youtubeID,
				requestedBy: stanza.fromUsername,
				time: new Date().getTime(),
				title: videoObj.title
			};
			playlist.push( songObj );
			setPlaylist( playlist, chat );

			Log.log( `Song: ${videoObj.title} has been added to the playlist by ${stanza.fromUsername}` );
			chat.replyTo( stanza.fromUsername, `Your song has been added to the playlist!` );
		} )

    }
}, {
	// Skip current song
	// MOD only - or vote to skip
    types: ['message'],
    regex: /^(!|\/)skip$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let user = chat.getUser( stanza.fromUsername );

		if ( player.started && user.role === 'moderator' ) {
			skipSong( chat );
		}
    }
}, {
	// Pause current song
	// MOD only
    types: ['message'],
    regex: /^(!|\/)pause$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let user = chat.getUser( stanza.fromUsername );
		if ( player.started && user.role === 'moderator' ) {
			player.playing = false;
			setPlayer( player, chat );

			websocket.sendMessage( chat.credentials.room, {
				message: 'pause'
			});
		}
    }
}, {
	// Play current song
	// MOD only
    types: ['message'],
    regex: /^(!|\/)play$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let user = chat.getUser( stanza.fromUsername );
		if ( player.started && user.role === 'moderator' ) {
			player.playing = true;
			setPlayer( player, chat );

			websocket.sendMessage( chat.credentials.room, {
				message: 'play'
			});
		}
    }
}, {
	// Fire up the youtube player
	// MOD only
    types: ['message'],
    regex: /^(!|\/)startplayer$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let user = chat.getUser( stanza.fromUsername );
		if ( user.role === 'moderator' ) {
			player.started = true;
			player.playing = true;
			setPlayer( player, chat );

			let playlist = getPlaylist( chat );
			if ( playlist.length > 0 ) {
				// Player is playing a song
				let currentSong = playlist[ player.currentSongIndex ];
				websocket.sendMessage( chat.credentials.room, {
					message: 'skip',
					youtubeID: currentSong.youtubeID
				});
			}
		}
    }
}, {
	// List next songs in the playlist
    types: ['message'],
    regex: /^(!|\/)upcoming$/,
    action: function( chat, stanza ) {
		let player = getPlayer( chat );
		let playlist = getPlaylist( chat );
		let songs = [];
		let songsToDisplay = 5;
		if ( playlist.length < songsToDisplay ) {
			songsToDisplay = playlist.length;
		}

		let songIndex = player.currentSongIndex
		for ( let i = 0; i < songsToDisplay; i++ ) {
			if ( playlist.length === ( songIndex + 1 ) ) {
				songIndex = 0;
			} else {
				songIndex++;
			}
			songs.push( playlist[ songIndex ].title );
		}

		let msg = 'Next ' + songsToDisplay + ' songs:' + '\n';
		msg += songs.join('\n');

		chat.sendMessage( msg );
    }
}];

/**
 * Skips to the next song
 * @param  {Client} chat
 * @return void
 */
function skipSong( chat ) {
	let player = getPlayer( chat );
	let playlist = getPlaylist( chat );

	if ( playlist.length === ( player.currentSongIndex + 1 ) ) {
		// Current song is the last in the playlist, restart the playlist
		player.currentSongIndex = 0;
	} else {
		// Skip to next track in the playlist
		player.currentSongIndex++;
	}
	setPlayer( player, chat );

	if ( player.playing && playlist.length > 0 ) {
		// Player is playing a song
		let currentSong = playlist[ player.currentSongIndex ];
		websocket.sendMessage( chat.credentials.room, {
			message: 'skip',
			youtubeID: currentSong.youtubeID
		});
	}
}

/**
 * Returns the youtube-node client.
 * @param  {Client} chat
 * @return {YouTube}
 */
function getYoutubeClient( chat ) {
	let youtube = new YouTube();
	youtube.setKey( chat.credentials.youtubeApiKey );
	return youtube;
}

/**
 * Get the player status from the brain.
 * @param {Client} chat
 * @return {obj} player
 */
function getPlayer( chat ) {
	return chat.getSetting( 'songPlayer' ) || {
		playing: false,
		currentSongIndex: 0
	};
}

/**
 * Save the player status to the brain.
 * @param {obj} player
 * @param {Client} chat
 */
function setPlayer( player, chat ) {
	chat.saveSetting( 'songPlayer', player );
}

/**
 * Returns the playlist from the brain.
 * @param  {Client} chat
 * @return {array}
 */
function getPlaylist( chat ) {
	return chat.getSetting( 'playlist' ) || [];
}

/**
 * Saves the playlist to the brain.
 * @param  {array} playlist
 * @param  {Client} chat
 * @return void
 */
function setPlaylist( playlist, chat ) {
	chat.saveSetting( 'playlist', playlist );
}