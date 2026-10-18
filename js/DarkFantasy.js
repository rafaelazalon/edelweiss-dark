
/*
	DarkFantasy: the "3D pixel art" look.

	- The scene is rendered into a small render target (around 200-300 pixels
	  on the short side of the screen), then stretched to the screen without
	  smoothing, which gives the chunky pixel look.
	- A post shader grades the colours (cold, desaturated, violet shadows),
	  posterizes them with an ordered dither, and adds a vignette.
	- The mountain map gets LPC textures: ash rock and blighted moss on the
	  floors, cold cliff rock on the walls (projected from world position,
	  so the original map UVs don't matter).
	- A night sky dome with a blood moon replaces the original skybox.
*/

function DarkFantasy() {

	// Palette used across the game (fog, sky, lights, UI)
	const COLORS = {
		fog: 0x1b1524,
		caveBackground: 0x0c0a0f,
		ambient: 0x8f86b0,
		moonLight: 0xb9c3ff,
		torch: 0xff8a3d
	};

	const TEXELS_PER_UNIT = 22 ; // texture density on the map, matches the low-res render

	// Size of the low-res render: the short side of the screen gets this many pixels
	const MIN_LOW_RES = 180 ;
	const MAX_LOW_RES = 300 ;

	///////////////////////
	///  PIXEL RENDERER
	///////////////////////

	var lowRes = new THREE.Vector2();

	var renderTarget = new THREE.WebGLRenderTarget( 2, 2, {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		format: THREE.RGBAFormat,
		stencilBuffer: false
	});
	renderTarget.texture.generateMipmaps = false ;

	var postCamera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	var postScene = new THREE.Scene();

	var postMaterial = new THREE.ShaderMaterial({
		uniforms: {
			tDiffuse: { value: renderTarget.texture },
			uRes: { value: lowRes },
			uHurt: { value: 0 }
		},
		depthTest: false,
		depthWrite: false,
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: `
			uniform sampler2D tDiffuse;
			uniform vec2 uRes;
			uniform float uHurt;
			varying vec2 vUv;

			// 4x4 ordered (Bayer) dither, without arrays
			float bayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
			float bayer4( vec2 a ) { return bayer2( 0.5 * a ) * 0.25 + bayer2( a ); }

			void main() {

				vec3 c = texture2D( tDiffuse, vUv ).rgb;

				// grade: desaturate, cold tint, deeper shadows, violet lift in the darks
				c *= 1.35; // exposure
				float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
				c = mix( vec3( l ), c, 0.75 );
				c *= vec3( 0.93, 0.88, 1.04 );
				c = pow( c, vec3( 1.05 ) );
				c += vec3( 0.035, 0.015, 0.06 ) * ( 1.0 - l );

				// damage feedback
				c = mix( c, c * vec3( 1.6, 0.35, 0.35 ), uHurt );

				// posterize with dither on the low-res pixel grid
				const float LEVELS = 12.0;
				float d = bayer4( floor( vUv * uRes ) ) - 0.5;
				c = floor( c * LEVELS + 0.5 + d * 0.45 ) / LEVELS;

				// vignette
				vec2 v = vUv - 0.5;
				c *= 1.0 - dot( v, v ) * 0.9;

				gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
			}
		`
	});

	postScene.add( new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), postMaterial ) );

	function resize() {

		let w = window.innerWidth ;
		let h = window.innerHeight ;

		let shortSide = Math.min( w, h );
		let target = Math.min( MAX_LOW_RES, Math.max( MIN_LOW_RES, Math.round( shortSide / 3 ) ) );
		let scale = target / shortSide ;

		lowRes.set( Math.max( 1, Math.round( w * scale ) ), Math.max( 1, Math.round( h * scale ) ) );

		renderTarget.setSize( lowRes.x, lowRes.y );

	};

	resize();

	function render() {

		if ( skyDome ) skyDome.position.copy( camera.position );

		renderer.setRenderTarget( renderTarget );
		renderer.clear();
		renderer.render( scene, camera );

		renderer.setRenderTarget( null );
		renderer.clear();
		renderer.render( postScene, postCamera );

	};

	// 0..1 red flash when the hero gets hurt
	function setHurt( value ) {
		postMaterial.uniforms.uHurt.value = value ;
	};

	///////////////////////
	///  NIGHT SKY
	///////////////////////

	var skyDome ;

	function makeSkyTexture() {

		const W = 256, H = 128 ;
		let canvas = document.createElement( 'canvas' );
		canvas.width = W ;
		canvas.height = H ;
		let ctx = canvas.getContext( '2d' );

		// banded gradient, from black-violet at the top to the fog colour at the horizon
		const bands = [ '#07060b', '#0b0912', '#100c19', '#151020', '#1a1424', '#1b1524' ];
		let horizon = H / 2 ;
		for ( let i = 0 ; i < bands.length ; i++ ) {
			ctx.fillStyle = bands[ i ];
			ctx.fillRect( 0, Math.floor( ( horizon / bands.length ) * i ), W, Math.ceil( horizon / bands.length ) + 1 );
		};
		ctx.fillStyle = '#1b1524' ;
		ctx.fillRect( 0, horizon, W, H - horizon );

		// stars
		let seed = 7 ;
		function rand() { seed = ( seed * 16807 ) % 2147483647 ; return seed / 2147483647 ; };
		for ( let i = 0 ; i < 90 ; i++ ) {
			let y = Math.floor( rand() * horizon * 0.85 );
			ctx.fillStyle = rand() > 0.85 ? '#d9d2ff' : '#6d6488' ;
			ctx.fillRect( Math.floor( rand() * W ), y, 1, 1 );
		};

		// blood moon with a dim halo
		let mx = 70, my = 30 ;
		ctx.fillStyle = '#2a1520' ;
		ctx.beginPath(); ctx.arc( mx, my, 13, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = '#9e2b2b' ;
		ctx.beginPath(); ctx.arc( mx, my, 8, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = '#c94a3a' ;
		ctx.beginPath(); ctx.arc( mx - 1, my - 1, 6, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = '#7d2024' ;
		ctx.fillRect( mx + 1, my + 1, 3, 2 );
		ctx.fillRect( mx - 4, my + 2, 2, 2 );

		// distant jagged peaks on the horizon
		ctx.fillStyle = '#120e19' ;
		let peak = horizon ;
		for ( let x = 0 ; x < W ; x++ ) {
			peak += ( rand() - 0.5 ) * 3 ;
			peak = Math.min( horizon + 2, Math.max( horizon - 14, peak ) );
			ctx.fillRect( x, Math.floor( peak ), 1, H );
		};

		let texture = new THREE.CanvasTexture( canvas );
		texture.magFilter = THREE.NearestFilter ;
		texture.minFilter = THREE.NearestFilter ;
		texture.generateMipmaps = false ;
		return texture ;

	};

	skyDome = new THREE.Mesh(
		new THREE.SphereBufferGeometry( 10, 24, 12 ),
		new THREE.MeshBasicMaterial({
			map: makeSkyTexture(),
			side: THREE.BackSide,
			fog: false,
			depthWrite: false
		})
	);
	skyDome.renderOrder = -1 ;
	skyDome.frustumCulled = false ;
	scene.add( skyDome );

	///////////////////////
	///  AMBIENCE
	///////////////////////

	var fog = new THREE.FogExp2( COLORS.fog, 0.075 );
	var fogColor = new THREE.Color( COLORS.fog );
	var caveColor = new THREE.Color( COLORS.caveBackground );

	ambientLight.color.set( COLORS.ambient );

	// called by MapManager each time the map changes
	function applyMapAmbience( mapName ) {

		let outside = mapName == 'mountain' ;

		skyDome.visible = outside ;
		scene.fog = outside ? fog : null ;
		scene.background = outside ? fogColor : caveColor ;

	};

	///////////////////////
	///  LPC MAP TEXTURES
	///////////////////////

	function loadPixelTexture( url ) {
		let t = textureLoader.load( url );
		t.magFilter = THREE.NearestFilter ;
		t.minFilter = THREE.NearestFilter ;
		t.generateMipmaps = false ;
		t.wrapS = t.wrapT = THREE.RepeatWrapping ;
		return t ;
	};

	var mapTextures = {
		ash: loadPixelTexture( 'assets/lpc/floor_ash.png' ),
		moss: loadPixelTexture( 'assets/lpc/floor_moss.png' ),
		cliff: loadPixelTexture( 'assets/lpc/cliff.png' )
	};

	// texture sizes in pixels, to keep the same pixel density everywhere
	const ASH_SIZE = new THREE.Vector2( 128, 64 );
	const MOSS_SIZE = new THREE.Vector2( 128, 64 );
	const CLIFF_SIZE = new THREE.Vector2( 64, 64 );

	/*
	Material for the map meshes: a Lambert material whose colour comes from
	the LPC textures, projected on X/Y/Z from the world position. The original
	map texture (if any) is only kept as a light/dark detail on top.
	*/
	function makeTerrainMaterial( originalMap ) {

		let material = new THREE.MeshLambertMaterial({
			map: originalMap || null,
			side: THREE.FrontSide
		});

		material.onBeforeCompile = function( shader ) {

			shader.uniforms.tAsh = { value: mapTextures.ash };
			shader.uniforms.tMoss = { value: mapTextures.moss };
			shader.uniforms.tCliff = { value: mapTextures.cliff };
			shader.uniforms.uAshScale = { value: new THREE.Vector2( TEXELS_PER_UNIT, TEXELS_PER_UNIT ).divide( ASH_SIZE ) };
			shader.uniforms.uMossScale = { value: new THREE.Vector2( TEXELS_PER_UNIT, TEXELS_PER_UNIT ).divide( MOSS_SIZE ) };
			shader.uniforms.uCliffScale = { value: new THREE.Vector2( TEXELS_PER_UNIT, TEXELS_PER_UNIT ).divide( CLIFF_SIZE ) };

			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', `
					#include <common>
					varying vec3 vTriPos;
					varying vec3 vTriNormal;
				`)
				.replace( '#include <fog_vertex>', `
					#include <fog_vertex>
					vTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
					vTriNormal = normalize( mat3( modelMatrix ) * objectNormal );
				`);

			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', `
					#include <common>
					varying vec3 vTriPos;
					varying vec3 vTriNormal;
					uniform sampler2D tAsh;
					uniform sampler2D tMoss;
					uniform sampler2D tCliff;
					uniform vec2 uAshScale;
					uniform vec2 uMossScale;
					uniform vec2 uCliffScale;

					float triHash( vec2 p ) {
						return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
					}

					// blocky value noise, used to scatter moss patches on the ash
					float triNoise( vec2 p ) {
						vec2 i = floor( p );
						vec2 f = fract( p );
						f = f * f * ( 3.0 - 2.0 * f );
						float a = triHash( i );
						float b = triHash( i + vec2( 1.0, 0.0 ) );
						float c = triHash( i + vec2( 0.0, 1.0 ) );
						float d = triHash( i + vec2( 1.0, 1.0 ) );
						return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
					}
				`)
				.replace( '#include <map_fragment>', `
					vec3 triN = abs( normalize( vTriNormal ) );
					vec3 triColor;

					if ( triN.y > 0.6 ) {

						// floors: ash rock with patches of blighted moss
						vec3 ash = texture2D( tAsh, vTriPos.xz * uAshScale ).rgb;
						vec3 moss = texture2D( tMoss, vTriPos.xz * uMossScale ).rgb;
						// snap the noise to the texel grid so patch edges stay pixelated
						vec2 snapped = floor( vTriPos.xz * 22.0 ) / 22.0;
						float patches = triNoise( snapped * 0.55 );
						triColor = patches > 0.62 ? moss : ash;

					} else if ( triN.x > triN.z ) {

						triColor = texture2D( tCliff, vTriPos.zy * uCliffScale ).rgb;

					} else {

						triColor = texture2D( tCliff, vTriPos.xy * uCliffScale ).rgb;

					}

					#ifdef USE_MAP
						// keep the light and shade baked in the original map as detail
						vec3 original = mapTexelToLinear( texture2D( map, vUv ) ).rgb;
						float detail = dot( original, vec3( 0.299, 0.587, 0.114 ) );
						triColor *= mix( 1.0, 0.55 + detail * 0.9, 0.45 );
					#endif

					diffuseColor.rgb *= triColor * 1.35;
				`);

		};

		return material ;

	};

	///////////////////////
	///  PIXEL TEXTURES
	///////////////////////

	// Make every texture of a loaded model pixel-sharp
	function pixelateModel( object ) {

		object.traverse( ( child )=> {

			if ( child.material && child.material.map ) {

				child.material.map.magFilter = THREE.NearestFilter ;
				child.material.map.needsUpdate = true ;

			};

		});

	};

	//

	return {
		COLORS,
		render,
		resize,
		setHurt,
		applyMapAmbience,
		makeTerrainMaterial,
		pixelateModel,
		loadPixelTexture
	};

};
