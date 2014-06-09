"use strict";

/// vwf/model/sound.js is a sound driver that wraps the capabilities of the 
/// HTML5 web audio API.
/// 
/// @module vwf/model/sound
/// @requires vwf/model

// References:
//  http://www.html5rocks.com/en/tutorials/webaudio/intro/
//  https://dvcs.w3.org/hg/audio/raw-file/tip/webaudio/specification.html
//  http://www.html5rocks.com/en/tutorials/webaudio/fieldrunners/

define( [ "module", "vwf/model" ], function( module, model ) {

    // TODO: should these be stored in this.state so that the view can access them?
    var context;
    var soundData = {};
    var logger;

    //var self = this;

    var driver = model.load( module, {

        initialize: function() {
            // In case somebody tries to reference it before we get a chance to create it.
            // (it's created in the view)
            this.state.soundManager = {};

            logger = this.logger;

            try {
                // I quote: "For WebKit- and Blink-based browsers, you 
                // currently need to use the webkit prefix, i.e. 
                // webkitAudioContext."
                // http://www.html5rocks.com/en/tutorials/webaudio/intro/
                if ( !window.AudioContext ) {
                    window.AudioContext = window.webkitAudioContext;
                }
                context = new AudioContext();
            }
            catch( e ) {
                // alert( 'Web Audio API is not supported in this browser' );
                logger.warnx( "initialize", "Web Audio API is not supported in this browser." );
            }
        },

        callingMethod: function( nodeID, methodName, params ) { 
            if ( nodeID !== this.state.soundManager.nodeID ) {
                return undefined;
            }

            if ( !context ) {
                return undefined;
            }

            // variables that we'll need in the switch statement below.  These all have function
            // scope, might as well declare them here.
            var soundDefinition, successCallback, failureCallback, exitCallback;
            var soundName, soundNames, soundDatum, soundDefinition, soundInstance;
            var instanceIDs, i, volume, fadeTime, fadeMethod, instanceHandle;

            switch( methodName ) {
                // arguments: soundDefinition, successCallback, failureCallback
                case "loadSound":
                    soundDefinition = params[ 0 ];
                    successCallback = params[ 1 ];
                    failureCallback = params[ 2 ];

                    if ( soundDefinition === undefined ) {
                        logger.errorx( "loadSound", "The 'loadSound' method requires " +
                                       "a definition for the sound." );
                        return undefined;
                    }

                    soundName = soundDefinition.soundName;
                    if ( soundName === undefined ) {
                        logger.errorx( "loadSound", "The sound definition must contain soundName." );
                        return undefined;
                    }

                    if ( soundData[ soundName ] != undefined ) {
                        logger.errorx( "loadSound", "Duplicate sound named '" + soundName + "'." );
                        return undefined;
                    }

                    if ( soundDefinition.soundURL === undefined ) {
                        logger.errorx( "loadSound", "The sound definition for '" + soundName +
                                       "' must contain soundURL." );
                        return undefined;
                    }

                    if (soundDefinition.isLayered === undefined) {
                        logger.errorx( "loadSound", "The sound definition for '" + soundName +
                                       "' must specify isLayered" );
                        return undefined;
                    }
                    // Create the sound.
                    // NOTE: the sound file is loaded into a buffer asynchronously, so the
                    // sound will not be ready to play immediately.  That's why we have the
                    // callbacks.

                    if (soundDefinition.isLayered == false) {
                        soundData[ soundDefinition.soundName ] = new SoundDatum( soundDefinition, successCallback, 
                                                                failureCallback );
                    }
                    else{
                        soundData[ soundDefinition.soundName ] = new LayeredSoundDatum( soundDefinition, successCallback, 
                                                                failureCallback );
                    }

                    return;

                // arguments: <none>
                case "clearAllSounds":
                    soundNames = Object.keys( soundData );
                    for ( i = 0; i < soundNames.length; ++i ) {
                        soundName = soundNames[ i ];
                        this.state.soundManager.stopAllSoundInstances( soundName );
                        delete soundData[ soundName ];
                    }
                    return;

                // arguments: soundName 
                // returns: true if sound is done loading and is playable
                case "isReady":
                    soundDatum = getSoundDatum( soundDefinition.soundName );
                    return soundDatum !== undefined ? !!soundDatum.buffer : false;

                // arguments: soundName, exitCallback (which is called when the sound stops) 
                // returns: an instance handle, which is an object: 
                //   { soundName: value, instanceID: value }
                //   instanceID is -1 on failure  
                case "playSound":

                    soundDatum = getSoundDatum( params[0].soundName );
                    exitCallback = params[ 1 ];
                    return soundDatum ? soundDatum.playSound( exitCallback ) 
                                      : { soundName: params[ 0 ], instanceID: -1 };


                // arguments: soundName
                // returns: true if sound is currently playing
                case "isSoundPlaying":
                    soundDatum = getSoundDatum( soundDefinition.soundName );
                    return soundDatum ? soundDatum.playingInstances.length > 0 : false;

                // arguments: instanceHandle
                // returns: true if sound is currently playing
                case "isInstancePlaying":
                    return getSoundInstance( params[ 0 ] ) !== undefined;

                // arguments: instanceHandle, volume, fadeTime, fadeMethod
                case "setVolume":
                    
                instanceHandle = params[ 0 ];
                    soundInstance = getSoundInstance( instanceHandle );
                    if ( soundInstance ) {
                        volume = params[ 1 ];
                        fadeTime = params[ 2 ];
                        fadeMethod = params[ 3 ];

                        soundInstance.setVolume( volume, fadeTime, fadeMethod );
                    }
                    return;
                
                // arguments: instanceHandle
                case "stopSoundInstance":
                    instanceHandle = params[ 0 ];
                    soundInstance = getSoundInstance( instanceHandle );
                    if ( soundInstance ) {
                        soundInstance.soundDatum.stopInstance( instanceHandle.instanceID );
                    }
                    return;

                // arguments: soundName
                case "stopAllSoundInstances":
                    for (var soundDatum in soundData){
                    soundDatum = getSoundDatum( params[ 0 ] );
                    if ( soundDatum ) {
                        instanceIDs = Object.keys( soundDatum.playingInstances );
                        for ( i = 0; i < instanceIDs.length; ++i ) {
                            soundDatum.stopInstance( instanceIDs[ i ] );
                        }
                    }
                    }
                    return undefined;
            }

            return undefined;
        }

    } );

    function SoundDatum( soundDefinition, successCallback, failureCallback ) {
        this.initialize( soundDefinition, successCallback, failureCallback );
        return this;
    }

    function LayeredSoundDatum( layeredSoundDefinition, successCallback, failureCallback ) {
        this.initialize( layeredSoundDefinition, successCallback, failureCallback );
        return this;
    }

    LayeredSoundDatum.prototype = {
        constructor: LayeredSoundDatum,

        name:"",
        instanceIDCounter: 0,
        startingLayers: [ 0 ],
        randomizeLayers:false,
        soundDatums:[ 0 ],
        loadedCount: 0,
        soundDefinitions:[ 0 ],
        layerCount: 0,

        initialize: function ( layeredSoundDefinition, successCallback, failureCallback ){

            this.name = layeredSoundDefinition.soundName;
            this.soundDefinitions = layeredSoundDefinition.soundDefinitions;
            this.layerCount = layeredSoundDefinition.soundDefinitions.length;
            this.soundDatums = [];

            for (var k in layeredSoundDefinition.soundDefinitions){

                var loadNext = function() {
                    logger.errorx( "loadNext", "loaded Next!" );
                }
                var doneLoading = function() {
                    logger.errorx( "doneLoading", "done loading!!" );
                        successCallback && successCallback()
                }
                var failureToLoad = function() {
                    failureCallback && failureCallback();
                }

               // if (i == this.layerCount-1) {
               //     var subName = layeredSoundDefinition.soundDefinitions[i].soundName;
                //    this.soundDatums[ subName ] = subName;
                //    soundData[ subName ] = new SoundDatum( layeredSoundDefinition.soundDefinitions[i], doneLoading, failureToLoad );
                //}else{
                    var subName = layeredSoundDefinition.soundDefinitions[k].soundName;
                    this.soundDatums[ subName ] = subName;
                    soundData[ subName ] = new SoundDatum( layeredSoundDefinition.soundDefinitions[k], loadNext, failureToLoad );
                  // this.loadSound(layeredSoundDefinition.soundDefinitions[k], loadNext, failureToLoad );
                //}
            }
        },
        playSound: function () {

            logger.errorx( "playSound", "!" );

            for ( var x in this.soundDatums){
                var played = function() {
                    logger.errorx( "played", "played" );
                }
                logger.errorx( "playSound", "playing track:"+x );
                soundData[ x ].playSound(played);

            }
            
        },
        startLayer: function ( id ) {

            //Check if within bounds of available layers
            //Check if already playing

            if ( id === undefined ) {
                logger.errorx( "startLayer", "The 'startLayer' method requires " +
                                       "an ID for the layer" );
                return undefined;
            }
            if ( id >= this.layerCount ) {
                logger.errorx( "startLayer", "The 'startLayer' method must be provided " +
                                       "a layer ID within bounds of the total layer count" );
                return undefined;
            }

            

        
            


        },
        stopLayer: function ( id ) {

            //Check if within bounds of available layers
            //Check if already stopped


            if ( id === undefined ) {
                logger.errorx( "stopLayer", "The 'stopLayer' method requires " +
                                       "an ID for the layer" );
                return undefined;
            }
            if ( id >= this.layerCount ) {
                logger.errorx( "stopLayer", "The 'stopLayer' method must be provided " +
                                       "a layer ID within bounds of the total layer count" );
                return undefined;
            }

            var soundLayer = this.soundDatums [ id ];

            logger.errorx( "stoppingSoundLayer", "stopping track:"+id );
               // self.(this.soundDatums[x].name);

            var soundInstances = this.playingInstances;

            for (var x in soundInstances){

                if ( soundInstance ) {

                soundInstance.sourceNode.stop();
                }

            }

        },
        startOnLoop: function ( id ) {

            //Is this necessary? If sub-layers are set to loop we may not need this
        },
        setVolumeForLayer: function( id, volume, duration) {

            //Set the volume for a particular layer
        },

    }

    SoundDatum.prototype = {
        constructor: SoundDatum,

        self: this,

        // the name
        name: "",

        // the actual sound
        buffer: null,

        // a hashtable of sound instances
        playingInstances: null,

        // control parameters
        isLooping: false,
        allowMultiplay: false,
        volumeAdjustment: 1.0,
        soundDefinition: null,
        // a counter for creating instance IDs
        instanceIDCounter: 0,

        initialize: function( soundDefinition, successCallback, failureCallback ) {
            this.name = soundDefinition.soundName;
            this.allowMultiplay = soundDefinition.allowMultiplay;
            this.volumeAdjustment = soundDefinition.volumeAdjustment;
            this.playingInstances = {};
            this.soundDefinition = soundDefinition;

            if ( this.soundDefinition.isLooping !== undefined ) {
                this.isLooping = soundDefinition.isLooping;
            }

            if ( this.soundDefinition.allowMultiplay !== undefined ) {
                this.allowMultiplay = soundDefinition.allowMultiplay;
            }

            if ( this.soundDefinition.volumeAdjustment !== undefined ) {
                this.volumeAdjustment = soundDefinition.volumeAdjustment;
            }

            // Create & send the request to load the sound asynchronously
            var request = new XMLHttpRequest();
            request.open( 'GET', soundDefinition.soundURL, true );
            request.responseType = 'arraybuffer';

           request.onload = function() {
                context.decodeAudioData(
                    request.response, 
                    function( buffer ) {
                        self.buffer = buffer;

                        successCallback && successCallback();
                    }, 
                    function() {
                        logger.warnx( "initialize", "Failed to load sound: '" + 
                                      name + "." );

                        delete soundData[ self.name ];

                        failureCallback && failureCallback();
                    }
                );
            }
            request.send();
        },

        playSound: function( exitCallback ) {
            if ( !this.buffer ) {
                logger.errorx( "playSound", "Sound '" + name + "' hasn't finished " +
                               "loading, or loaded improperly." );
                return { soundName: this.name, instanceID: -1 };
            }

            if ( !this.allowMultiplay && ( this.playingInstances.length > 0 ) ) {
                logger.warnx( "playSound", "Sound '" + name + "'is already " +
                              "playing, and doesn't allow multiplay." );
                return { soundName: this.name, instanceID: -1 };
            }

            var id = this.instanceIDCounter;
            ++this.instanceIDCounter;

            this.playingInstances[ id ] = new PlayingInstance( this, id, exitCallback );

            return { soundName: this.name, instanceID: id };
        },

        stopInstance: function( instanceID ) {
            var soundInstance = this.playingInstances[ instanceID ];
            if ( soundInstance ) {
                soundInstance.sourceNode.stop();
            }
        },
        
    }

    function PlayingInstance( soundDatum, id, exitCallback ) {
        this.initialize( soundDatum, id, exitCallback );
        return this;
    }

    PlayingInstance.prototype = {
        constructor: PlayingInstance,

        // a reference back to the soundDatum
        soundDatum: null,

        // the control nodes for the flowgraph
        sourceNode: undefined,
        gainNode: undefined,

        initialize: function( soundDatum, id, exitCallback ) {
            // NOTE: from http://www.html5rocks.com/en/tutorials/webaudio/intro/:
            //
            // An important point to note is that on iOS, Apple currently mutes all sound 
            // output until the first time a sound is played during a user interaction 
            // event - for example, calling playSound() inside a touch event handler. 
            // You may struggle with Web Audio on iOS "not working" unless you circumvent 
            // this - in order to avoid problems like this, just play a sound (it can even
            // be muted by connecting to a Gain Node with zero gain) inside an early UI
            // event - e.g. "touch here to play".

            this.soundDatum = soundDatum;

            this.sourceNode = context.createBufferSource();
            this.sourceNode.buffer = this.soundDatum.buffer;
            this.sourceNode.loop = this.soundDatum.isLooping;

            this.gainNode = context.createGain();
            this.gainNode.gain.value = this.soundDatum.volumeAdjustment;

            this.sourceNode.connect( this.gainNode );
            this.gainNode.connect( context.destination );

            this.sourceNode.start( 0 );

            var soundDatum = this.soundDatum;
            this.sourceNode.onended = function() {
                delete soundDatum.playingInstances[ id ];
                exitCallback && exitCallback();
            }
        },

        setVolume: function( volume, fadeTime, fadeMethod ) {
            if ( !volume ) {
                logger.errorx( "setVolume", "The 'setVolume' method " +
                               "requires a volume." );
                return;
            }

            targetVolume = volume * this.soundDatum.volumeAdjustment;
            fadeTime = fadeTime ? fadeTime : 0;
            fadeMethod = fadeMethod ? fadeMethod : "linear";

            if ( fadeTime <= 0 ) {
                gainNode.gain.value = targetVolume;
            } else {
                var endTime = context.currentTime + fadeTime;

                switch( fadeMethod ) {
                    case "linear":
                        gainNode.gain.linearRampToValueAtTime( targetVolume, endTime );
                        break;
                    case "exponential":
                        gainNode.gain.exponentialRampToValueAtTime( targetVolume, endTime );
                        break;
                    default:
                        logger.errorx( "setVolume", "Unknonwn fade method: '" +
                                       fadeMethod + "'.  Using a linear fade.");
                        gainNode.gain.linearRampToValueAtTime( targetVolume, endTime );
                }
            }
        },
    }

    function getSoundDatum( soundName ) {
        if ( soundName === undefined ) {
            logger.errorx( "getSoundDatum", "The 'getSoundDatum' method " +
                           "requires the sound name." );
            return undefined;
        }

        var soundDatum = soundData[ soundName ];
        if ( soundDatum === undefined ) {
            logger.errorx( "getSoundDatum", "Sound '" + soundName + "' not found.");
            return undefined;
        }

        return soundDatum;
    }

    function getSoundInstance( instanceHandle ) {
        if ( instanceHandle === undefined ) {
            logger.errorx( "getSoundInstance", "The 'GetSoundInstance' method " +
                           "requires the instance ID." );
            return undefined;
        }

        if ( ( instanceHandle.soundName === undefined ) || 
             ( instanceHandle.instanceID === undefined ) ) {
            logger.errorx( "getSoundInstance", "The instance handle must contain " +
                           "soundName and the instanceID values");
            return undefined;
        }

        var soundDatum = getSoundDatum( instanceHandle.soundName );
        return soundDatum ? soundDatum.playingInstances[ instanceHandle.instanceID ] : undefined;
    }

    return driver;

} );


