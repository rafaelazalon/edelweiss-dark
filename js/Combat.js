
/*
	Combat: hero health, sword attack and LPC monsters.

	- The hero has 5 hearts. Touching a monster's attack costs one heart,
	  followed by a short invulnerability. At 0 hearts the hero dies and
	  respawns at the last save point, like a fall death.
	- Attack: F / J / K / X keys, left mouse click, or the sword button on
	  touch screens. A moonlit blade sweeps in front of the hero.
	- Monsters (LPC sprites, always facing the camera, with a 4-direction
	  animation): skeleton, zombie, bat and ghost. They patrol around their
	  spawn point, chase the hero when close, and only walk on the map's
	  ground tiles so they never fall off the mountain.
	- Respawning (dying) heals the hero and brings every monster back,
	  like resting at a bonfire.
*/

function Combat() {

	const MAX_HP = 5 ;
	const INVULN_TIME = 1.3 ;		// s of invulnerability after a hit
	const RESPAWN_INVULN = 2.0 ;
	const ATTACK_COOLDOWN = 0.38 ;	// s between two sword swings
	const ATTACK_DURATION = 0.2 ;	// s of the swing animation
	const ATTACK_REACH = 0.85 ;		// world units in front of the hero
	const ACTIVE_RADIUS = 15 ;		// monsters further than this are frozen and hidden
	const ENEMY_MAX = 28 ;
	const ENEMY_SPACING = 6 ;		// min distance between two spawn points
	const SAFE_RADIUS = 5 ;			// no monster near the start point and NPCs
	const LEASH = 7 ;				// a monster gives up the chase this far from home
	const DEAD_TIME = 40 ;			// s before a slain monster comes back (if the hero is away)
	const GROUND_MARGIN = 0.12 ;	// monsters stay this far from ground edges
	const STEP_HEIGHT = 0.35 ;		// max height difference a monster can walk

	var hp = MAX_HP ;
	var invuln = 0 ;
	var cooldown = 0 ;
	var attackTimer = 0 ;
	var hurtFlash = 0 ;

	var enemies = [];
	var spawned = false ;

	const domHearts = document.getElementById( 'hearts' );
	const domAttackButton = document.getElementById( 'attack-button' );

	//////////////////////
	///  MONSTER TYPES
	//////////////////////

	/*
	layout 'humanoid': LPC character sheet with 64x64 frames,
		rows 0-3 walk (up, left, down, right), 9 frames,
		rows 4-7 slash, 6 frames, row 8 hurt/collapse, 6 frames.
	layout 'grid3': 3 frames x 4 directions (up, left, down, right).
	*/
	const TYPES = {
		skeleton: {
			url: 'assets/lpc/skeleton.png', sheetW: 576, sheetH: 576, fw: 64, fh: 64, layout: 'humanoid',
			height: 0.95, feet: 2, hp: 2, speed: 0.7, chase: 1.35, aggro: 4.5, float: 0,
			particle: 0xd9d0c0, tint: 0xc4bccf
		},
		zombie: {
			url: 'assets/lpc/zombie.png', sheetW: 576, sheetH: 576, fw: 64, fh: 64, layout: 'humanoid',
			height: 0.95, feet: 2, hp: 3, speed: 0.4, chase: 0.85, aggro: 4, float: 0,
			particle: 0x5f7a3e, tint: 0xb5b8b0
		},
		bat: {
			url: 'assets/lpc/bat.png', sheetW: 96, sheetH: 128, fw: 32, fh: 32, layout: 'grid3',
			height: 0.55, feet: 5, hp: 1, speed: 1.1, chase: 2.0, aggro: 5.5, float: 0.45,
			particle: 0x7e64a8, tint: 0xc9bfe0
		},
		ghost: {
			url: 'assets/lpc/ghost.png', sheetW: 120, sheetH: 184, fw: 40, fh: 46, layout: 'grid3',
			height: 0.8, feet: 6, hp: 2, speed: 0.5, chase: 1.15, aggro: 5, float: 0.2,
			particle: 0xd6e6a0, tint: 0xd0d8c8, opacity: 0.82
		}
	};

	for ( let name in TYPES ) {
		let t = textureLoader.load( TYPES[ name ].url );
		t.magFilter = THREE.NearestFilter ;
		t.minFilter = THREE.NearestFilter ;
		t.generateMipmaps = false ;
		TYPES[ name ].texture = t ;
	};

	const shadowGeometry = new THREE.CircleBufferGeometry( 0.17, 8 );
	shadowGeometry.rotateX( - Math.PI / 2 );
	const shadowMaterial = new THREE.MeshBasicMaterial({
		color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false
	});

	//////////////////////
	///  HUD
	//////////////////////

	function renderHearts() {

		let html = '' ;
		for ( let i = 0 ; i < MAX_HP ; i++ ) {
			html += `<span class="heart${ i < hp ? '' : ' empty' }"></span>` ;
		};
		domHearts.innerHTML = html ;

	};

	renderHearts();

	//////////////////////
	///  SOUND EFFECTS
	//////////////////////

	// Tiny synthesized sounds, no audio files needed
	var audioCtx, noiseBuffer ;

	function sfx( kind ) {

		try {

			if ( !audioCtx ) {
				audioCtx = new ( window.AudioContext || window.webkitAudioContext )();
				noiseBuffer = audioCtx.createBuffer( 1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate );
				let data = noiseBuffer.getChannelData( 0 );
				for ( let i = 0 ; i < data.length ; i++ ) data[ i ] = Math.random() * 2 - 1 ;
			};

			if ( audioCtx.state == 'suspended' ) audioCtx.resume();

			let t = audioCtx.currentTime ;
			let out = audioCtx.createGain();
			out.connect( audioCtx.destination );

			function noise( from, to, duration, volume ) {
				let src = audioCtx.createBufferSource();
				src.buffer = noiseBuffer ;
				let filter = audioCtx.createBiquadFilter();
				filter.type = 'bandpass' ;
				filter.frequency.setValueAtTime( from, t );
				filter.frequency.exponentialRampToValueAtTime( to, t + duration );
				let gain = audioCtx.createGain();
				gain.gain.setValueAtTime( volume, t );
				gain.gain.exponentialRampToValueAtTime( 0.001, t + duration );
				src.connect( filter ); filter.connect( gain ); gain.connect( out );
				src.start( t ); src.stop( t + duration );
			};

			function tone( type, from, to, duration, volume ) {
				let osc = audioCtx.createOscillator();
				osc.type = type ;
				osc.frequency.setValueAtTime( from, t );
				osc.frequency.exponentialRampToValueAtTime( to, t + duration );
				let gain = audioCtx.createGain();
				gain.gain.setValueAtTime( volume, t );
				gain.gain.exponentialRampToValueAtTime( 0.001, t + duration );
				osc.connect( gain ); gain.connect( out );
				osc.start( t ); osc.stop( t + duration );
			};

			switch ( kind ) {
				case 'swing' : noise( 2400, 500, 0.14, 0.22 ); break ;
				case 'hit' : tone( 'square', 190, 60, 0.12, 0.12 ); noise( 900, 300, 0.1, 0.2 ); break ;
				case 'kill' : tone( 'triangle', 320, 40, 0.4, 0.2 ); noise( 600, 100, 0.3, 0.15 ); break ;
				case 'hurt' : tone( 'sawtooth', 230, 90, 0.28, 0.14 ); break ;
				case 'growl' : tone( 'sawtooth', 70, 45, 0.35, 0.06 ); break ;
			};

		} catch ( err ) {
			// no audio available, play silently
		};

	};

	//////////////////////
	///  SWORD
	//////////////////////

	var swordPivot = new THREE.Group();
	var slashArc ;

	( function buildSword() {

		const steel = new THREE.MeshBasicMaterial({ color: 0xc9cde6 });
		const brass = new THREE.MeshBasicMaterial({ color: 0x6b3f2c });
		const leather = new THREE.MeshBasicMaterial({ color: 0x24171a });

		let blade = new THREE.Mesh( new THREE.BoxBufferGeometry( 0.035, 0.012, 0.42 ), steel );
		blade.position.z = 0.3 ;
		let guard = new THREE.Mesh( new THREE.BoxBufferGeometry( 0.15, 0.02, 0.03 ), brass );
		guard.position.z = 0.08 ;
		let grip = new THREE.Mesh( new THREE.BoxBufferGeometry( 0.03, 0.03, 0.09 ), leather );
		grip.position.z = 0.025 ;

		let sword = new THREE.Group();
		sword.add( blade, guard, grip );
		sword.position.x = -0.06 ;

		swordPivot.add( sword );
		swordPivot.position.y = 0.34 ;
		swordPivot.visible = false ;

		// pale crescent showing the swing
		const ARC = 2.6 ;
		slashArc = new THREE.Mesh(
			new THREE.RingBufferGeometry( 0.22, 0.66, 18, 1, - Math.PI / 2 - ARC / 2, ARC ),
			new THREE.MeshBasicMaterial({
				color: 0xdcd4ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
				depthWrite: false, fog: false
			})
		);
		slashArc.rotation.x = - Math.PI / 2 ;
		slashArc.position.y = 0.32 ;
		slashArc.visible = false ;

	})();

	var swordAttached = false ;

	function attachSword() {

		if ( swordAttached || !atlas || !atlas.player ) return ;
		atlas.player.charaGroup.add( swordPivot );
		atlas.player.charaGroup.add( slashArc );
		swordAttached = true ;

	};

	function updateSword( delta ) {

		if ( attackTimer <= 0 ) {
			swordPivot.visible = false ;
			slashArc.visible = false ;
			return ;
		};

		attackTimer -= delta ;
		let progress = 1 - Math.max( 0, attackTimer ) / ATTACK_DURATION ;

		// sweep from the hero's left to their right
		swordPivot.visible = true ;
		swordPivot.rotation.y = 1.5 - progress * 3.0 ;
		swordPivot.rotation.z = 0.35 ;

		slashArc.visible = true ;
		slashArc.material.opacity = 0.75 * ( 1 - progress );
		slashArc.scale.setScalar( 0.85 + progress * 0.2 );

	};

	//////////////////////
	///  PARTICLES
	//////////////////////

	const particleGeometry = new THREE.BoxBufferGeometry( 0.045, 0.045, 0.045 );
	var particles = [];

	for ( let i = 0 ; i < 48 ; i++ ) {
		let mesh = new THREE.Mesh( particleGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }) );
		mesh.visible = false ;
		scene.add( mesh );
		particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
	};

	function burst( position, color, count ) {

		let spawnedCount = 0 ;

		for ( let p of particles ) {
			if ( p.life > 0 ) continue ;
			p.life = 0.45 + Math.random() * 0.35 ;
			p.mesh.visible = true ;
			p.mesh.material.color.set( color );
			p.mesh.position.copy( position );
			p.velocity.set( ( Math.random() - 0.5 ) * 2.4, 1 + Math.random() * 1.6, ( Math.random() - 0.5 ) * 2.4 );
			if ( ++spawnedCount >= count ) break ;
		};

	};

	function updateParticles( delta ) {

		for ( let p of particles ) {
			if ( p.life <= 0 ) continue ;
			p.life -= delta ;
			p.velocity.y -= 6 * delta ;
			p.mesh.position.addScaledVector( p.velocity, delta );
			p.mesh.rotation.x += delta * 8 ;
			if ( p.life <= 0 ) p.mesh.visible = false ;
		};

	};

	//////////////////////
	///  GROUND
	//////////////////////

	/*
	Height of the walkable ground under (x, z), close to the height y.
	Returns null if there is no ground there (void, wall, edge).
	Uses the same logic tiles as the hero's physics.
	*/
	function groundAt( x, z, y ) {

		let graph = atlas.getSceneGraph();
		if ( !graph || !graph.tilesGraph ) return null ;

		let best = null ;
		let base = Math.floor( y );

		for ( let stage = base - 1 ; stage <= base + 1 ; stage++ ) {

			let tiles = graph.tilesGraph[ stage ];
			if ( !tiles ) continue ;

			for ( let tile of tiles ) {

				if ( tile.isWall || !/ground/.test( tile.type ) ) continue ;

				let p0 = tile.points[0], p1 = tile.points[1];

				if ( x < Math.min( p0.x, p1.x ) + GROUND_MARGIN ||
					 x > Math.max( p0.x, p1.x ) - GROUND_MARGIN ||
					 z < Math.min( p0.z, p1.z ) + GROUND_MARGIN ||
					 z > Math.max( p0.z, p1.z ) - GROUND_MARGIN ) continue ;

				let dy = Math.abs( p0.y - y );
				if ( dy <= STEP_HEIGHT && ( best === null || dy < Math.abs( best - y ) ) ) best = p0.y ;

			};

		};

		return best ;

	};

	//////////////////////
	///  SPAWNING
	//////////////////////

	function spawnEnemies() {

		let graph = gameState.sceneGraphs.mountain ;
		if ( !graph || !graph.tilesGraph ) return false ;

		// places to keep free of monsters: start point, NPCs, gates
		let avoid = [ atlas.player.position.clone() ];

		if ( graph.cubesGraph ) graph.cubesGraph.forEach( ( stage )=> {
			if ( stage ) stage.forEach( ( cube )=> {
				if ( /interactive|trigger/.test( cube.type ) && cube.position ) {
					avoid.push( new THREE.Vector3( cube.position.x, cube.position.y, cube.position.z ) );
				};
			});
		});

		// large enough ground tiles
		let candidates = [];
		let maxY = 1 ;

		graph.tilesGraph.forEach( ( stage )=> {
			if ( stage ) stage.forEach( ( tile )=> {
				if ( tile.isWall || !/ground/.test( tile.type ) || /start/.test( tile.type ) ) return ;
				let p0 = tile.points[0], p1 = tile.points[1];
				let w = Math.abs( p0.x - p1.x ), d = Math.abs( p0.z - p1.z );
				if ( w < 0.8 || d < 0.8 ) return ;
				candidates.push( new THREE.Vector3( ( p0.x + p1.x ) / 2, p0.y, ( p0.z + p1.z ) / 2 ) );
				maxY = Math.max( maxY, p0.y );
			});
		});

		// deterministic shuffle, so the world is the same every game
		let seed = 1337 ;
		function rand() { seed = ( seed * 16807 ) % 2147483647 ; return seed / 2147483647 ; };
		for ( let i = candidates.length - 1 ; i > 0 ; i-- ) {
			let j = Math.floor( rand() * ( i + 1 ) );
			[ candidates[ i ], candidates[ j ] ] = [ candidates[ j ], candidates[ i ] ];
		};

		let picked = [];

		for ( let c of candidates ) {
			if ( picked.length >= ENEMY_MAX ) break ;
			if ( avoid.some( ( a )=> a.distanceTo( c ) < SAFE_RADIUS ) ) continue ;
			if ( picked.some( ( p )=> p.distanceTo( c ) < ENEMY_SPACING ) ) continue ;
			picked.push( c );
		};

		// the higher on the mountain, the stranger the creatures
		for ( let home of picked ) {
			let height = home.y / maxY ;
			let r = rand();
			let type =
				height < 0.3 ? ( r < 0.7 ? 'skeleton' : 'zombie' ) :
				height < 0.6 ? ( r < 0.4 ? 'skeleton' : r < 0.7 ? 'zombie' : 'bat' ) :
							   ( r < 0.35 ? 'bat' : r < 0.7 ? 'ghost' : 'skeleton' );
			enemies.push( createEnemy( type, home ) );
		};

		return true ;

	};

	function createEnemy( typeName, home ) {

		let def = TYPES[ typeName ];
		let width = def.height * def.fw / def.fh ;

		let geometry = new THREE.PlaneBufferGeometry( width, def.height );
		let material = new THREE.MeshBasicMaterial({
			map: def.texture,
			color: def.tint,
			alphaTest: 0.5,
			side: THREE.DoubleSide,
			transparent: !!def.opacity,
			opacity: def.opacity || 1
		});

		let sprite = new THREE.Mesh( geometry, material );
		sprite.position.y = def.height / 2 - def.height * ( def.feet / def.fh ) + def.float ;

		let shadow = new THREE.Mesh( shadowGeometry, shadowMaterial );
		shadow.position.y = 0.012 ;

		let group = new THREE.Group();
		group.add( sprite, shadow );
		group.position.copy( home );
		group.visible = false ;
		scene.add( group );

		let enemy = {
			def, sprite, shadow, group, material, geometry,
			home: home.clone(),
			pos: group.position,
			target: home.clone(),
			dir: Math.random() * Math.PI * 2,
			knock: new THREE.Vector2(),
			state: 'idle',
			stateTime: Math.random() * 2,
			animTime: Math.random() * 5,
			flash: 0,
			hp: def.hp,
			deadTimer: 0,
			hasStruck: false
		};

		setFrame( enemy, 2, 0, 0 );

		return enemy ;

	};

	// show one frame of the sprite sheet: direction row, frame column, row offset
	function setFrame( enemy, dirRow, col, rowOffset ) {

		let def = enemy.def ;
		let x = col * def.fw ;
		let y = ( rowOffset + dirRow ) * def.fh ;

		let u0 = x / def.sheetW, u1 = ( x + def.fw ) / def.sheetW ;
		let v1 = 1 - y / def.sheetH, v0 = 1 - ( y + def.fh ) / def.sheetH ;

		let uv = enemy.geometry.attributes.uv ;
		uv.setXY( 0, u0, v1 );
		uv.setXY( 1, u1, v1 );
		uv.setXY( 2, u0, v0 );
		uv.setXY( 3, u1, v0 );
		uv.needsUpdate = true ;

	};

	function revive( enemy ) {

		enemy.hp = enemy.def.hp ;
		enemy.pos.copy( enemy.home );
		enemy.target.copy( enemy.home );
		enemy.state = 'idle' ;
		enemy.stateTime = Math.random() * 2 ;
		enemy.flash = 0 ;
		enemy.knock.set( 0, 0 );
		enemy.sprite.scale.set( 1, 1, 1 );
		enemy.material.opacity = enemy.def.opacity || 1 ;
		enemy.shadow.visible = true ;

	};

	//////////////////////
	///  MONSTER AI
	//////////////////////

	function setState( enemy, state ) {
		enemy.state = state ;
		enemy.stateTime = 0 ;
		enemy.hasStruck = false ;
	};

	function moveEnemy( enemy, dx, dz ) {

		let nx = enemy.pos.x + dx ;
		let nz = enemy.pos.z + dz ;
		let ground = groundAt( nx, nz, enemy.pos.y );

		if ( ground === null ) return false ;

		enemy.pos.x = nx ;
		enemy.pos.z = nz ;
		enemy.pos.y += ( ground - enemy.pos.y ) * 0.5 ;
		if ( Math.abs( ground - enemy.pos.y ) < 0.01 ) enemy.pos.y = ground ;

		return true ;

	};

	function walkToward( enemy, tx, tz, speed, delta ) {

		let dx = tx - enemy.pos.x ;
		let dz = tz - enemy.pos.z ;
		let dist = Math.sqrt( dx * dx + dz * dz );
		if ( dist < 0.05 ) return true ;

		enemy.dir = Math.atan2( dx, dz );
		let step = Math.min( dist, speed * delta );

		return moveEnemy( enemy, ( dx / dist ) * step, ( dz / dist ) * step );

	};

	function pickPatrolTarget( enemy ) {
		let a = Math.random() * Math.PI * 2 ;
		let r = 0.8 + Math.random() * 1.8 ;
		enemy.target.set( enemy.home.x + Math.sin( a ) * r, enemy.home.y, enemy.home.z + Math.cos( a ) * r );
	};

	// which of the 4 sprite rows to show, from the monster's facing and the camera position
	function directionRow( enemy ) {

		let toCamera = Math.atan2( camera.position.x - enemy.pos.x, camera.position.z - enemy.pos.z );
		let d = utils.toPiRange( enemy.dir - toCamera );

		if ( Math.abs( d ) < Math.PI / 4 ) return 2 ;		// facing the camera
		if ( Math.abs( d ) > Math.PI * 3 / 4 ) return 0 ;	// back to the camera
		return d > 0 ? 3 : 1 ;							// moving to screen right / left

	};

	function updateEnemy( enemy, delta, onMountain, playerPos, playerAvailable ) {

		if ( !onMountain ) {
			enemy.group.visible = false ;
			return ;
		};

		let dist = enemy.pos.distanceTo( playerPos );

		// slain: wait, then come back when the hero is not looking
		if ( enemy.state == 'dead' ) {
			enemy.group.visible = false ;
			enemy.deadTimer -= delta ;
			if ( enemy.deadTimer <= 0 && enemy.home.distanceTo( playerPos ) > 9 ) revive( enemy );
			return ;
		};

		if ( dist > ACTIVE_RADIUS ) {
			enemy.group.visible = false ;
			return ;
		};

		enemy.group.visible = true ;
		enemy.stateTime += delta ;
		enemy.animTime += delta ;

		let def = enemy.def ;
		let dx = playerPos.x - enemy.pos.x ;
		let dz = playerPos.z - enemy.pos.z ;
		let flatDist = Math.sqrt( dx * dx + dz * dz );
		let dy = playerPos.y - enemy.pos.y ;
		let canSee = playerAvailable && flatDist < def.aggro && dy > -1.2 && dy < 1.4 &&
					 enemy.home.distanceTo( enemy.pos ) < LEASH ;
		let inReach = playerAvailable && flatDist < 0.48 && dy > -0.5 && dy < 0.7 ;

		let moving = false ;

		switch ( enemy.state ) {

			case 'idle' :
				if ( canSee ) { setState( enemy, 'chase' ); sfx( 'growl' ); break ; }
				if ( enemy.stateTime > 1.5 ) { pickPatrolTarget( enemy ); setState( enemy, 'patrol' ); }
				break ;

			case 'patrol' :
				if ( canSee ) { setState( enemy, 'chase' ); sfx( 'growl' ); break ; }
				moving = true ;
				if ( !walkToward( enemy, enemy.target.x, enemy.target.z, def.speed, delta ) ||
					 enemy.stateTime > 4 ||
					 Math.hypot( enemy.target.x - enemy.pos.x, enemy.target.z - enemy.pos.z ) < 0.08 ) {
					setState( enemy, 'idle' );
				};
				break ;

			case 'chase' :
				if ( inReach ) { setState( enemy, 'attack' ); break ; }
				if ( !canSee ) { enemy.target.copy( enemy.home ); setState( enemy, 'return' ); break ; }
				moving = true ;
				walkToward( enemy, playerPos.x, playerPos.z, def.chase, delta );
				break ;

			case 'return' :
				if ( canSee && enemy.home.distanceTo( enemy.pos ) < LEASH - 1 ) { setState( enemy, 'chase' ); break ; }
				moving = true ;
				if ( !walkToward( enemy, enemy.home.x, enemy.home.z, def.speed, delta ) ||
					 enemy.home.distanceTo( enemy.pos ) < 0.15 ) {
					setState( enemy, 'idle' );
				};
				break ;

			case 'attack' :
				// wind up, strike at mid-animation, recover
				enemy.dir = Math.atan2( dx, dz );
				if ( !enemy.hasStruck && enemy.stateTime > 0.32 ) {
					enemy.hasStruck = true ;
					if ( playerAvailable && flatDist < 0.62 && dy > -0.5 && dy < 0.75 ) hurtPlayer( enemy );
				};
				if ( enemy.stateTime > 0.6 ) setState( enemy, 'recover' );
				break ;

			case 'recover' :
				if ( enemy.stateTime > 0.55 ) setState( enemy, canSee ? 'chase' : 'idle' );
				break ;

			case 'hurt' :
				if ( enemy.stateTime > 0.32 ) setState( enemy, 'chase' );
				break ;

			case 'dying' :
				let p = Math.min( 1, enemy.stateTime / 0.7 );
				enemy.material.opacity = ( def.opacity || 1 ) * ( 1 - p * p );
				enemy.material.transparent = true ;
				enemy.shadow.visible = p < 0.5 ;
				if ( def.layout != 'humanoid' ) enemy.sprite.scale.set( 1 + p * 0.4, 1 - p * 0.8, 1 );
				if ( p >= 1 ) {
					enemy.state = 'dead' ;
					enemy.deadTimer = DEAD_TIME ;
					enemy.material.transparent = !!def.opacity ;
				};
				break ;

		};

		// knockback from sword hits
		if ( enemy.knock.lengthSq() > 0.0001 ) {
			moveEnemy( enemy, enemy.knock.x * delta, enemy.knock.y * delta );
			enemy.knock.multiplyScalar( Math.max( 0, 1 - delta * 9 ) );
		};

		// red flash when hit
		if ( enemy.flash > 0 ) {
			enemy.flash -= delta ;
			enemy.material.color.set( enemy.flash > 0 ? 0xff3030 : def.tint );
		};

		// billboard: always face the camera, stay upright
		enemy.sprite.rotation.y = Math.atan2( camera.position.x - enemy.pos.x, camera.position.z - enemy.pos.z );

		// hovering creatures bob up and down
		if ( def.float ) {
			enemy.sprite.position.y = def.height / 2 - def.height * ( def.feet / def.fh ) + def.float +
									  Math.sin( enemy.animTime * 4 ) * 0.05 ;
		};

		animate( enemy, moving );

	};

	function animate( enemy, moving ) {

		let def = enemy.def ;
		let row = directionRow( enemy );

		if ( def.layout == 'humanoid' ) {

			if ( enemy.state == 'attack' ) {
				setFrame( enemy, row, Math.min( 5, Math.floor( ( enemy.stateTime / 0.6 ) * 6 ) ), 4 );
			} else if ( enemy.state == 'dying' ) {
				setFrame( enemy, 0, Math.min( 5, Math.floor( ( enemy.stateTime / 0.5 ) * 6 ) ), 8 );
			} else if ( enemy.state == 'hurt' ) {
				setFrame( enemy, 0, 1, 8 );
			} else if ( moving ) {
				setFrame( enemy, row, 1 + Math.floor( enemy.animTime * 9 ) % 8, 0 );
			} else {
				setFrame( enemy, row, 0, 0 );
			};

		} else {

			let speed = enemy.state == 'attack' ? 14 : ( moving || def.float ) ? 7 : 3 ;
			setFrame( enemy, row, Math.floor( enemy.animTime * speed ) % 3, 0 );

		};

	};

	//////////////////////
	///  HURTING
	//////////////////////

	function hurtPlayer( enemy ) {

		if ( invuln > 0 || hp <= 0 || gameState.params.isDying ) return ;

		hp -= 1 ;
		renderHearts();
		invuln = INVULN_TIME ;
		hurtFlash = 1 ;
		sfx( 'hurt' );
		if ( window.navigator.vibrate ) window.navigator.vibrate( 80 );

		// push the monster back so it doesn't hit again right away
		let dx = enemy.pos.x - atlas.player.position.x ;
		let dz = enemy.pos.z - atlas.player.position.z ;
		let len = Math.max( 0.001, Math.sqrt( dx * dx + dz * dz ) );
		enemy.knock.set( ( dx / len ) * 2.5, ( dz / len ) * 2.5 );

		if ( hp <= 0 ) {
			atlas.player.charaGroup.visible = true ;
			charaAnim.die();
			gameState.die();
		};

	};

	function damageEnemy( enemy, fx, fz ) {

		enemy.hp -= 1 ;
		enemy.flash = 0.15 ;

		let center = enemy.pos.clone();
		center.y += enemy.def.float + enemy.def.height * 0.45 ;

		if ( enemy.hp <= 0 ) {
			setState( enemy, 'dying' );
			burst( center, enemy.def.particle, 14 );
			sfx( 'kill' );
		} else {
			setState( enemy, 'hurt' );
			enemy.knock.set( fx * 3.2, fz * 3.2 );
			burst( center, enemy.def.particle, 5 );
			sfx( 'hit' );
		};

	};

	//////////////////////
	///  ATTACK
	//////////////////////

	function canAct() {

		if ( !atlas || !atlas.player || !controler ) return false ;
		if ( gameState.params.isGamePaused || gameState.params.isDying ) return false ;
		if ( interaction.isInDialogue() ) return false ;

		let s = controler.state ;
		return !( controler.isBusy() || s.isClimbing || s.isSlipping || s.isDashing || s.chargingDash );

	};

	function attack() {

		if ( cooldown > 0 || !canAct() ) return ;

		attachSword();

		cooldown = ATTACK_COOLDOWN ;
		attackTimer = ATTACK_DURATION ;
		sfx( 'swing' );

		let angle = atlas.player.charaGroup.rotation.y ;
		let fx = Math.sin( angle ), fz = Math.cos( angle );
		let p = atlas.player.position ;

		for ( let enemy of enemies ) {

			if ( !enemy.group.visible || enemy.hp <= 0 || /dying|dead/.test( enemy.state ) ) continue ;

			let dx = enemy.pos.x - p.x ;
			let dz = enemy.pos.z - p.z ;
			let dist = Math.sqrt( dx * dx + dz * dz );
			let dy = ( enemy.pos.y + enemy.def.float ) - p.y ;

			if ( dist > ATTACK_REACH || dy < -0.45 || dy > 0.95 ) continue ;
			if ( dist > 0.3 && ( dx * fx + dz * fz ) / dist < 0.2 ) continue ; // behind the hero

			damageEnemy( enemy, fx, fz );

		};

	};

	//////////////////////
	///  UPDATE
	//////////////////////

	function update( delta ) {

		delta = Math.min( delta, 0.05 );

		if ( !atlas || !atlas.player || !gameState || !mapManager ) return ;

		if ( !spawned && gameState.sceneGraphs && gameState.sceneGraphs.mountain ) {
			spawned = spawnEnemies();
		};

		// timers and feedback
		if ( cooldown > 0 ) cooldown -= delta ;

		if ( hurtFlash > 0 ) {
			hurtFlash = Math.max( 0, hurtFlash - delta * 2.5 );
			darkFantasy.setHurt( hurtFlash * 0.6 );
		};

		if ( invuln > 0 ) {
			invuln -= delta ;
			atlas.player.charaGroup.visible = invuln <= 0 || Math.floor( invuln * 14 ) % 2 == 0 ;
		};

		updateSword( delta );
		updateParticles( delta );

		// the world freezes during menus and dialogues
		if ( gameState.params.isGamePaused || interaction.isInDialogue() ) return ;

		let onMountain = mapManager.params.currentMap == 'mountain' &&
						 atlas.getSceneGraph() == gameState.sceneGraphs.mountain ;

		let playerAvailable = !gameState.params.isDying && hp > 0 ;
		let playerPos = atlas.player.position ;

		for ( let enemy of enemies ) {
			updateEnemy( enemy, delta, onMountain, playerPos, playerAvailable );
		};

	};

	// called by gameState when the hero respawns: heal and reset the monsters
	function onRespawn() {

		hp = MAX_HP ;
		renderHearts();
		invuln = RESPAWN_INVULN ;
		hurtFlash = 0 ;
		darkFantasy.setHurt( 0 );

		for ( let enemy of enemies ) revive( enemy );

	};

	//////////////////////
	///  INPUT
	//////////////////////

	window.addEventListener( 'keydown', ( e )=> {
		if ( e.repeat ) return ;
		if ( /^(KeyF|KeyJ|KeyK|KeyX)$/.test( e.code ) ) attack();
	});

	document.getElementById( 'world' ).addEventListener( 'mousedown', ( e )=> {
		if ( e.button === 0 && !input.params.isTouchScreen ) attack();
	});

	domAttackButton.addEventListener( 'touchstart', ( e )=> {
		if ( e.cancelable ) e.preventDefault();
		attack();
		domAttackButton.classList.add( 'pressed' );
		if ( window.navigator.vibrate ) window.navigator.vibrate( 15 );
	});

	domAttackButton.addEventListener( 'touchend', ( e )=> {
		if ( e.cancelable ) e.preventDefault();
		domAttackButton.classList.remove( 'pressed' );
	});

	//

	return {
		update,
		attack,
		onRespawn,
		getHealth: ()=> hp,
		getEnemies: ()=> enemies
	};

};
