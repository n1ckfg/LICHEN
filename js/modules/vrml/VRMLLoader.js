/**
 * p5.js port of three.js' VRMLLoader (three/addons/loaders/VRMLLoader.js, r160).
 * Copied from the vrml-qtvr-viewer project (p5js/js/VRMLLoader-p5.js); only
 * the chevrotain import path differs.
 *
 * Minimum viable version: the chevrotain lexer, parser and AST visitor are
 * reused unchanged. The three.js scene construction is replaced by a builder
 * that bakes every Shape into world-space triangles and merges them into a few
 * p5.Geometry objects, with VRML Material and Color values as vertex colors.
 *
 * Supported: Group, Transform, Anchor, Collision, Billboard (as Group), Switch,
 * LOD (first level), Shape, Appearance, Material (diffuseColor, emissiveColor,
 * transparency), IndexedFaceSet (Color, colorIndex, colorPerVertex, ccw,
 * creaseAngle), Box, Cone, Cylinder, Sphere and Background (uniform skyColor).
 *
 * Not supported: textures, IndexedLineSet, PointSet, ElevationGrid, Extrusion,
 * Text, Inline, Normal nodes (normals are always generated), and lights,
 * viewpoints, sensors, interpolators and scripts.
 */

import chevrotain from '../../libraries/chevrotain.module.min.js';

let geometryId = 0;

class VRMLLoader {

	load( url, onLoad, onError ) {

		fetch( url )
			.then( ( response ) => {

				if ( ! response.ok ) throw new Error( 'VRMLLoader: ' + response.status + ' ' + url );

				return response.text();

			} )
			.then( ( text ) => onLoad( this.parse( text ) ) )
			.catch( ( e ) => onError ? onError( e ) : console.error( e ) );

	}

	/**
	 * Returns { geometries, boundingBox, background }:
	 * - geometries: p5.Geometry list for model(), opaque before transparent
	 * - boundingBox: { min: [ x, y, z ], max: [ x, y, z ] } in VRML space (y up), or null
	 * - background: [ r, g, b ] in 0..1 from the first uniform Background, or null
	 */
	parse( data ) {

		const nodeMap = {};
		const meshCache = new Map();
		const unsupported = new Set();

		const opaque = new MeshBuffer();
		const transparent = new MeshBuffer();
		const bounds = { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] };
		let background = null;

		function generateVRMLTree( data ) {

			// create lexer, parser and visitor

			const tokenData = createTokens();

			const lexer = new VRMLLexer( tokenData.tokens );
			const parser = new VRMLParser( tokenData.tokenVocabulary );
			const visitor = createVisitor( parser.getBaseCstVisitorConstructor() );

			// lexing

			const lexingResult = lexer.lex( data );
			parser.input = lexingResult.tokens;

			// parsing

			const cstOutput = parser.vrml();

			if ( parser.errors.length > 0 ) {

				console.error( parser.errors );

				throw Error( 'VRMLLoader: Parsing errors detected.' );

			}

			// actions

			const ast = visitor.visit( cstOutput );

			return ast;

		}

		function createTokens() {

			const createToken = chevrotain.createToken;

			// from http://gun.teipir.gr/VRML-amgem/spec/part1/concepts.html#SyntaxBasics

			const RouteIdentifier = createToken( { name: 'RouteIdentifier', pattern: /[^\x30-\x39\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d][^\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d]*[\.][^\x30-\x39\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d][^\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d]*/ } );
			const Identifier = createToken( { name: 'Identifier', pattern: /[^\x30-\x39\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d][^\0-\x20\x22\x27\x23\x2b\x2c\x2d\x2e\x5b\x5d\x5c\x7b\x7d]*/, longer_alt: RouteIdentifier } );

			// from http://gun.teipir.gr/VRML-amgem/spec/part1/nodesRef.html

			const nodeTypes = [
				'Anchor', 'Billboard', 'Collision', 'Group', 'Transform', // grouping nodes
				'Inline', 'LOD', 'Switch', // special groups
				'AudioClip', 'DirectionalLight', 'PointLight', 'Script', 'Shape', 'Sound', 'SpotLight', 'WorldInfo', // common nodes
				'CylinderSensor', 'PlaneSensor', 'ProximitySensor', 'SphereSensor', 'TimeSensor', 'TouchSensor', 'VisibilitySensor', // sensors
				'Box', 'Cone', 'Cylinder', 'ElevationGrid', 'Extrusion', 'IndexedFaceSet', 'IndexedLineSet', 'PointSet', 'Sphere', // geometries
				'Color', 'Coordinate', 'Normal', 'TextureCoordinate', // geometric properties
				'Appearance', 'FontStyle', 'ImageTexture', 'Material', 'MovieTexture', 'PixelTexture', 'TextureTransform', // appearance
				'ColorInterpolator', 'CoordinateInterpolator', 'NormalInterpolator', 'OrientationInterpolator', 'PositionInterpolator', 'ScalarInterpolator', // interpolators
				'Background', 'Fog', 'NavigationInfo', 'Viewpoint', // bindable nodes
				'Text' // Text must be placed at the end of the regex so there are no matches for TextureTransform and TextureCoordinate
			];

			//

			const Version = createToken( {
				name: 'Version',
				pattern: /#VRML.*/,
				longer_alt: Identifier
			} );

			const NodeName = createToken( {
				name: 'NodeName',
				pattern: new RegExp( nodeTypes.join( '|' ) ),
				longer_alt: Identifier
			} );

			const DEF = createToken( {
				name: 'DEF',
				pattern: /DEF/,
				longer_alt: Identifier
			} );

			const USE = createToken( {
				name: 'USE',
				pattern: /USE/,
				longer_alt: Identifier
			} );

			const ROUTE = createToken( {
				name: 'ROUTE',
				pattern: /ROUTE/,
				longer_alt: Identifier
			} );

			const TO = createToken( {
				name: 'TO',
				pattern: /TO/,
				longer_alt: Identifier
			} );

			//

			const StringLiteral = createToken( { name: 'StringLiteral', pattern: /"(?:[^\\"\n\r]|\\[bfnrtv"\\/]|\\u[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])*"/ } );
			const HexLiteral = createToken( { name: 'HexLiteral', pattern: /0[xX][0-9a-fA-F]+/ } );
			const NumberLiteral = createToken( { name: 'NumberLiteral', pattern: /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/ } );
			const TrueLiteral = createToken( { name: 'TrueLiteral', pattern: /TRUE/ } );
			const FalseLiteral = createToken( { name: 'FalseLiteral', pattern: /FALSE/ } );
			const NullLiteral = createToken( { name: 'NullLiteral', pattern: /NULL/ } );
			const LSquare = createToken( { name: 'LSquare', pattern: /\[/ } );
			const RSquare = createToken( { name: 'RSquare', pattern: /]/ } );
			const LCurly = createToken( { name: 'LCurly', pattern: /{/ } );
			const RCurly = createToken( { name: 'RCurly', pattern: /}/ } );
			const Comment = createToken( {
				name: 'Comment',
				pattern: /#.*/,
				group: chevrotain.Lexer.SKIPPED
			} );

			// commas, blanks, tabs, newlines and carriage returns are whitespace characters wherever they appear outside of string fields

			const WhiteSpace = createToken( {
				name: 'WhiteSpace',
				pattern: /[ ,\s]/,
				group: chevrotain.Lexer.SKIPPED
			} );

			const tokens = [
				WhiteSpace,
				// keywords appear before the Identifier
				NodeName,
				DEF,
				USE,
				ROUTE,
				TO,
				TrueLiteral,
				FalseLiteral,
				NullLiteral,
				// the Identifier must appear after the keywords because all keywords are valid identifiers
				Version,
				Identifier,
				RouteIdentifier,
				StringLiteral,
				HexLiteral,
				NumberLiteral,
				LSquare,
				RSquare,
				LCurly,
				RCurly,
				Comment
			];

			const tokenVocabulary = {};

			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				const token = tokens[ i ];

				tokenVocabulary[ token.name ] = token;

			}

			return { tokens: tokens, tokenVocabulary: tokenVocabulary };

		}


		function createVisitor( BaseVRMLVisitor ) {

			// the visitor is created dynmaically based on the given base class

			class VRMLToASTVisitor extends BaseVRMLVisitor {

				constructor() {

					super();

					this.validateVisitor();

				}

				vrml( ctx ) {

					const data = {
						version: this.visit( ctx.version ),
						nodes: [],
						routes: []
					};

					for ( let i = 0, l = ctx.node.length; i < l; i ++ ) {

						const node = ctx.node[ i ];

						data.nodes.push( this.visit( node ) );

					}

					if ( ctx.route ) {

						for ( let i = 0, l = ctx.route.length; i < l; i ++ ) {

							const route = ctx.route[ i ];

							data.routes.push( this.visit( route ) );

						}

					}

					return data;

				}

				version( ctx ) {

					return ctx.Version[ 0 ].image;

				}

				node( ctx ) {

					const data = {
						name: ctx.NodeName[ 0 ].image,
						fields: []
					};

					if ( ctx.field ) {

						for ( let i = 0, l = ctx.field.length; i < l; i ++ ) {

							const field = ctx.field[ i ];

							data.fields.push( this.visit( field ) );

						}

					}

					// DEF

					if ( ctx.def ) {

						data.DEF = this.visit( ctx.def[ 0 ] );

					}

					return data;

				}

				field( ctx ) {

					const data = {
						name: ctx.Identifier[ 0 ].image,
						type: null,
						values: null
					};

					let result;

					// SFValue

					if ( ctx.singleFieldValue ) {

						result = this.visit( ctx.singleFieldValue[ 0 ] );

					}

					// MFValue

					if ( ctx.multiFieldValue ) {

						result = this.visit( ctx.multiFieldValue[ 0 ] );

					}

					data.type = result.type;
					data.values = result.values;

					return data;

				}

				def( ctx ) {

					return ( ctx.Identifier || ctx.NodeName )[ 0 ].image;

				}

				use( ctx ) {

					return { USE: ( ctx.Identifier || ctx.NodeName )[ 0 ].image };

				}

				singleFieldValue( ctx ) {

					return processField( this, ctx );

				}

				multiFieldValue( ctx ) {

					return processField( this, ctx );

				}

				route( ctx ) {

					const data = {
						FROM: ctx.RouteIdentifier[ 0 ].image,
						TO: ctx.RouteIdentifier[ 1 ].image
					};

					return data;

				}

			}

			function processField( scope, ctx ) {

				const field = {
					type: null,
					values: []
				};

				if ( ctx.node ) {

					field.type = 'node';

					for ( let i = 0, l = ctx.node.length; i < l; i ++ ) {

						const node = ctx.node[ i ];

						field.values.push( scope.visit( node ) );

					}

				}

				if ( ctx.use ) {

					field.type = 'use';

					for ( let i = 0, l = ctx.use.length; i < l; i ++ ) {

						const use = ctx.use[ i ];

						field.values.push( scope.visit( use ) );

					}

				}

				if ( ctx.StringLiteral ) {

					field.type = 'string';

					for ( let i = 0, l = ctx.StringLiteral.length; i < l; i ++ ) {

						const stringLiteral = ctx.StringLiteral[ i ];

						field.values.push( stringLiteral.image.replace( /'|"/g, '' ) );

					}

				}

				if ( ctx.NumberLiteral ) {

					field.type = 'number';

					for ( let i = 0, l = ctx.NumberLiteral.length; i < l; i ++ ) {

						const numberLiteral = ctx.NumberLiteral[ i ];

						field.values.push( parseFloat( numberLiteral.image ) );

					}

				}

				if ( ctx.HexLiteral ) {

					field.type = 'hex';

					for ( let i = 0, l = ctx.HexLiteral.length; i < l; i ++ ) {

						const hexLiteral = ctx.HexLiteral[ i ];

						field.values.push( hexLiteral.image );

					}

				}

				if ( ctx.TrueLiteral ) {

					field.type = 'boolean';

					for ( let i = 0, l = ctx.TrueLiteral.length; i < l; i ++ ) {

						const trueLiteral = ctx.TrueLiteral[ i ];

						if ( trueLiteral.image === 'TRUE' ) field.values.push( true );

					}

				}

				if ( ctx.FalseLiteral ) {

					field.type = 'boolean';

					for ( let i = 0, l = ctx.FalseLiteral.length; i < l; i ++ ) {

						const falseLiteral = ctx.FalseLiteral[ i ];

						if ( falseLiteral.image === 'FALSE' ) field.values.push( false );

					}

				}

				if ( ctx.NullLiteral ) {

					field.type = 'null';

					ctx.NullLiteral.forEach( function () {

						field.values.push( null );

					} );

				}

				return field;

			}

			return new VRMLToASTVisitor();

		}

		function parseTree( tree ) {

			const nodes = tree.nodes;

			// first iteration: build nodemap based on DEF statements

			for ( let i = 0, l = nodes.length; i < l; i ++ ) {

				buildNodeMap( nodes[ i ] );

			}

			// second iteration: walk the scene graph and bake shapes

			for ( let i = 0, l = nodes.length; i < l; i ++ ) {

				traverse( nodes[ i ], IDENTITY );

			}

			if ( unsupported.size > 0 ) {

				console.warn( 'VRMLLoader: Skipped unsupported geometry:', [ ...unsupported ].join( ', ' ) );

			}

			const geometries = [ opaque, transparent ]
				.filter( ( buffer ) => buffer.positions.length > 0 )
				.map( toGeometry );

			return {
				geometries: geometries,
				boundingBox: geometries.length > 0 ? bounds : null,
				background: background
			};

		}

		function buildNodeMap( node ) {

			if ( node.DEF ) {

				nodeMap[ node.DEF ] = node;

			}

			const fields = node.fields;

			for ( let i = 0, l = fields.length; i < l; i ++ ) {

				const field = fields[ i ];

				// a field holding both nodes and USE references is typed 'use'

				if ( field.type === 'node' || field.type === 'use' ) {

					const fieldValues = field.values;

					for ( let j = 0, jl = fieldValues.length; j < jl; j ++ ) {

						if ( fieldValues[ j ].fields ) buildNodeMap( fieldValues[ j ] );

					}

				}

			}

		}

		// returns the node a field value refers to, or null for NULL / unknown USE

		function resolve( node ) {

			if ( node === null || node === undefined ) return null;

			if ( node.USE !== undefined ) return nodeMap[ node.USE ] || null;

			return node;

		}

		function getFields( node ) {

			if ( node.fieldMap === undefined ) {

				node.fieldMap = {};

				for ( const field of node.fields ) node.fieldMap[ field.name ] = field.values;

			}

			return node.fieldMap;

		}

		function getFieldNode( fields, name ) {

			return resolve( fields[ name ] ? fields[ name ][ 0 ] : null );

		}

		function getFieldValue( fields, name, defaultValue ) {

			return fields[ name ] ? fields[ name ][ 0 ] : defaultValue;

		}

		// scene graph

		function traverse( node, matrix ) {

			node = resolve( node );

			if ( node === null ) return;

			const fields = getFields( node );

			switch ( node.name ) {

				case 'Anchor':
				case 'Billboard':
				case 'Collision':
				case 'Group':
					traverseAll( fields.children, matrix );
					break;

				case 'Transform':
					traverseAll( fields.children, mat4Multiply( matrix, buildTransformMatrix( fields ) ) );
					break;

				case 'Switch': {

					// note: the parser lists a field's nodes before its USE references,
					// so whichChoice can be off when choices mix the two
					const choices = fields.choice || fields.children || [];
					const whichChoice = getFieldValue( fields, 'whichChoice', - 1 );
					if ( whichChoice >= 0 && whichChoice < choices.length ) traverse( choices[ whichChoice ], matrix );
					break;

				}

				case 'LOD': {

					const levels = fields.level || fields.children || [];
					if ( levels.length > 0 ) traverse( levels[ 0 ], matrix );
					break;

				}

				case 'Shape':
					buildShape( fields, matrix );
					break;

				case 'Background':
					// a uniform sky only; sky gradients are ignored
					if ( background === null && fields.skyColor && fields.skyColor.length === 3 ) {

						background = fields.skyColor.slice();

					}

					break;

				// all other nodes (lights, sensors, interpolators, Viewpoint, ...) have no geometry

			}

		}

		function traverseAll( nodes, matrix ) {

			if ( nodes === undefined ) return;

			for ( let i = 0, l = nodes.length; i < l; i ++ ) {

				traverse( nodes[ i ], matrix );

			}

		}

		function buildTransformMatrix( fields ) {

			// VRML97: T * C * R * SR * S * -SR * -C

			const t = fields.translation || [ 0, 0, 0 ];
			const c = fields.center || [ 0, 0, 0 ];
			const r = fields.rotation || [ 0, 0, 1, 0 ];
			const s = fields.scale || [ 1, 1, 1 ];
			const so = fields.scaleOrientation || [ 0, 0, 1, 0 ];

			let m = mat4Translation( t[ 0 ] + c[ 0 ], t[ 1 ] + c[ 1 ], t[ 2 ] + c[ 2 ] );
			m = mat4Multiply( m, mat4Rotation( r[ 0 ], r[ 1 ], r[ 2 ], r[ 3 ] ) );
			m = mat4Multiply( m, mat4Rotation( so[ 0 ], so[ 1 ], so[ 2 ], so[ 3 ] ) );
			m = mat4Multiply( m, mat4Scale( s[ 0 ], s[ 1 ], s[ 2 ] ) );
			m = mat4Multiply( m, mat4Rotation( so[ 0 ], so[ 1 ], so[ 2 ], - so[ 3 ] ) );
			m = mat4Multiply( m, mat4Translation( - c[ 0 ], - c[ 1 ], - c[ 2 ] ) );

			return m;

		}

		// shapes

		function buildShape( fields, matrix ) {

			const geometryNode = getFieldNode( fields, 'geometry' );

			if ( geometryNode === null ) return;

			// geometry shared via DEF/USE is triangulated once and baked per instance

			let mesh = meshCache.get( geometryNode );

			if ( mesh === undefined ) {

				mesh = buildMesh( geometryNode );
				meshCache.set( geometryNode, mesh );

			}

			if ( mesh === null || mesh.positions.length === 0 ) return;

			bakeMesh( mesh, matrix, getShapeColor( getFieldNode( fields, 'appearance' ) ) );

		}

		function getShapeColor( appearance ) {

			// without a Material, VRML renders unlit white

			const color = [ 1, 1, 1, 1 ];

			if ( appearance === null ) return color;

			const material = getFieldNode( getFields( appearance ), 'material' );

			if ( material === null ) return color;

			const fields = getFields( material );
			const diffuse = fields.diffuseColor || [ 0.8, 0.8, 0.8 ];
			const emissive = fields.emissiveColor || [ 0, 0, 0 ];

			// merged geometry has no per-shape materials, so emissive is folded into the color

			for ( let i = 0; i < 3; i ++ ) color[ i ] = Math.min( 1, diffuse[ i ] + emissive[ i ] );

			color[ 3 ] = 1 - getFieldValue( fields, 'transparency', 0 );

			return color;

		}

		function buildMesh( node ) {

			const fields = getFields( node );

			switch ( node.name ) {

				case 'IndexedFaceSet':
					return buildIndexedFaceSetMesh( fields );

				case 'Box':
					return buildBoxMesh( fields );

				case 'Cone':
					return buildTruncatedConeMesh(
						getFieldValue( fields, 'bottomRadius', 1 ), 0, getFieldValue( fields, 'height', 2 ),
						getFieldValue( fields, 'side', true ), false, getFieldValue( fields, 'bottom', true )
					);

				case 'Cylinder': {

					const radius = getFieldValue( fields, 'radius', 1 );

					return buildTruncatedConeMesh(
						radius, radius, getFieldValue( fields, 'height', 2 ),
						getFieldValue( fields, 'side', true ), getFieldValue( fields, 'top', true ), getFieldValue( fields, 'bottom', true )
					);

				}

				case 'Sphere':
					return buildSphereMesh( getFieldValue( fields, 'radius', 1 ) );

				default:
					unsupported.add( node.name );
					return null;

			}

		}

		// values of a Coordinate or Color node

		function getPointData( fields, name ) {

			const node = getFieldNode( fields, name );

			return ( node !== null && node.fields.length > 0 ) ? node.fields[ 0 ].values : null;

		}

		function buildIndexedFaceSetMesh( fields ) {

			const coord = getPointData( fields, 'coord' );
			const coordIndex = fields.coordIndex;

			if ( coord === null || coordIndex === undefined ) return null;

			const color = getPointData( fields, 'color' );
			const colorIndex = ( fields.colorIndex && fields.colorIndex.length > 0 ) ? fields.colorIndex : null;
			const colorPerVertex = getFieldValue( fields, 'colorPerVertex', true );
			const ccw = getFieldValue( fields, 'ccw', true );

			const mesh = new MeshData( getFieldValue( fields, 'creaseAngle', 0 ) );
			const vertexCount = coord.length / 3;

			if ( color !== null ) mesh.colors = [];

			let faceStart = 0, face = 0;

			for ( let i = 0; i <= coordIndex.length; i ++ ) {

				// an index of -1 indicates that the current face has ended and the next one begins

				if ( i < coordIndex.length && coordIndex[ i ] !== - 1 ) continue;

				const n = i - faceStart;

				// fan triangulation, as in three.js (assumes convex faces)

				for ( let k = 1; k < n - 1; k ++ ) {

					const corners = ccw ?
						[ faceStart, faceStart + k, faceStart + k + 1 ] :
						[ faceStart, faceStart + k + 1, faceStart + k ];

					if ( corners.some( ( c ) => ! ( coordIndex[ c ] >= 0 && coordIndex[ c ] < vertexCount ) ) ) continue;

					for ( const c of corners ) {

						const v = coordIndex[ c ];

						mesh.positions.push( coord[ v * 3 ], coord[ v * 3 + 1 ], coord[ v * 3 + 2 ] );
						mesh.keys.push( v );

						if ( color !== null ) {

							const ci = colorPerVertex ?
								( colorIndex ? colorIndex[ c ] : v ) :
								( colorIndex ? colorIndex[ face ] : face );

							mesh.colors.push( color[ ci * 3 ] ?? 1, color[ ci * 3 + 1 ] ?? 1, color[ ci * 3 + 2 ] ?? 1 );

						}

					}

				}

				if ( n > 0 ) face ++;

				faceStart = i + 1;

			}

			return mesh;

		}

		function buildBoxMesh( fields ) {

			const size = fields.size || [ 2, 2, 2 ];
			const half = [ size[ 0 ] / 2, size[ 1 ] / 2, size[ 2 ] / 2 ];

			// per face: normal axis, normal sign, then in-plane axes u, v with u x v = normal

			const faces = [
				[ 0, 1, 1, 2 ], [ 0, - 1, 2, 1 ],
				[ 1, 1, 2, 0 ], [ 1, - 1, 0, 2 ],
				[ 2, 1, 0, 1 ], [ 2, - 1, 1, 0 ]
			];

			const mesh = new MeshData( 0 );

			for ( const [ n, sign, u, v ] of faces ) {

				const corner = ( su, sv ) => {

					const p = [ 0, 0, 0 ];
					p[ n ] = sign * half[ n ];
					p[ u ] = su * half[ u ];
					p[ v ] = sv * half[ v ];
					return p;

				};

				const a = corner( - 1, - 1 ), b = corner( 1, - 1 ), c = corner( 1, 1 ), d = corner( - 1, 1 );

				mesh.addTriangle( a, b, c, 0, 0, 0 );
				mesh.addTriangle( a, c, d, 0, 0, 0 );

			}

			return mesh;

		}

		function buildSphereMesh( radius ) {

			const rows = 16, columns = 24;
			const mesh = new MeshData( Math.PI );

			const point = ( i, j ) => {

				const theta = Math.PI * i / rows, phi = 2 * Math.PI * j / columns;

				return [ radius * Math.sin( theta ) * Math.sin( phi ), radius * Math.cos( theta ), radius * Math.sin( theta ) * Math.cos( phi ) ];

			};

			// smoothing keys: close the seam and merge each pole into a single vertex

			const key = ( i, j ) => ( i === 0 ) ? 0 : ( i === rows ) ? 1 : 2 + i * columns + j % columns;

			for ( let i = 0; i < rows; i ++ ) {

				for ( let j = 0; j < columns; j ++ ) {

					const a = point( i, j ), b = point( i + 1, j ), c = point( i + 1, j + 1 ), d = point( i, j + 1 );

					// skip the degenerate triangles at the poles

					if ( i !== rows - 1 ) mesh.addTriangle( a, b, c, key( i, j ), key( i + 1, j ), key( i + 1, j + 1 ) );
					if ( i !== 0 ) mesh.addTriangle( a, c, d, key( i, j ), key( i + 1, j + 1 ), key( i, j + 1 ) );

				}

			}

			return mesh;

		}

		function buildTruncatedConeMesh( bottomRadius, topRadius, height, side, top, bottom ) {

			const segments = 24;
			const y0 = - height / 2, y1 = height / 2;

			// sides are smoothed; caps use their own keys so they stay flat

			const mesh = new MeshData( Math.PI );
			const bottomKey = ( j ) => j % segments;
			const topKey = ( j ) => segments + j % segments;
			const apexKey = ( j ) => 2 * segments + j;
			const topCapKey = - 1, bottomCapKey = - 2;

			const point = ( radius, y, j ) => {

				const phi = 2 * Math.PI * j / segments;

				return [ radius * Math.sin( phi ), y, radius * Math.cos( phi ) ];

			};

			for ( let j = 0; j < segments; j ++ ) {

				const a = point( topRadius, y1, j ), b = point( bottomRadius, y0, j );
				const c = point( bottomRadius, y0, j + 1 ), d = point( topRadius, y1, j + 1 );

				if ( side && topRadius > 0 ) {

					mesh.addTriangle( a, b, c, topKey( j ), bottomKey( j ), bottomKey( j + 1 ) );
					mesh.addTriangle( a, c, d, topKey( j ), bottomKey( j + 1 ), topKey( j + 1 ) );

				} else if ( side ) {

					mesh.addTriangle( a, b, c, apexKey( j ), bottomKey( j ), bottomKey( j + 1 ) );

				}

				if ( top && topRadius > 0 ) mesh.addTriangle( [ 0, y1, 0 ], a, d, topCapKey, topCapKey, topCapKey );
				if ( bottom ) mesh.addTriangle( [ 0, y0, 0 ], c, b, bottomCapKey, bottomCapKey, bottomCapKey );

			}

			return mesh;

		}

		// transforms a mesh into world space and appends it to the opaque or transparent buffer

		function bakeMesh( mesh, matrix, color ) {

			const buffer = color[ 3 ] < 1 ? transparent : opaque;
			const positions = transformPoints( mesh.positions, matrix );

			// a mirroring transform flips the winding; swap corners to keep normals outward

			const order = mat4Determinant3( matrix ) < 0 ? [ 0, 2, 1 ] : [ 0, 1, 2 ];
			const normals = computeNormals( positions, mesh.keys, mesh.creaseAngle, order );

			for ( let t = 0, tl = positions.length / 9; t < tl; t ++ ) {

				for ( const k of order ) {

					const i = t * 3 + k;
					const x = positions[ i * 3 ], y = positions[ i * 3 + 1 ], z = positions[ i * 3 + 2 ];

					buffer.positions.push( x, y, z );
					buffer.normals.push( normals[ i * 3 ], normals[ i * 3 + 1 ], normals[ i * 3 + 2 ] );

					if ( mesh.colors !== null ) {

						buffer.colors.push( mesh.colors[ i * 3 ], mesh.colors[ i * 3 + 1 ], mesh.colors[ i * 3 + 2 ], color[ 3 ] );

					} else {

						buffer.colors.push( color[ 0 ], color[ 1 ], color[ 2 ], color[ 3 ] );

					}

					bounds.min[ 0 ] = Math.min( bounds.min[ 0 ], x );
					bounds.min[ 1 ] = Math.min( bounds.min[ 1 ], y );
					bounds.min[ 2 ] = Math.min( bounds.min[ 2 ], z );
					bounds.max[ 0 ] = Math.max( bounds.max[ 0 ], x );
					bounds.max[ 1 ] = Math.max( bounds.max[ 1 ], y );
					bounds.max[ 2 ] = Math.max( bounds.max[ 2 ], z );

				}

			}

		}

		function toGeometry( buffer ) {

			const geometry = new p5.Geometry();

			// p5 caches GPU buffers by gid
			geometry.gid = 'vrml-' + ( geometryId ++ );

			for ( let i = 0, l = buffer.positions.length; i < l; i += 3 ) {

				geometry.vertices.push( new p5.Vector( buffer.positions[ i ], buffer.positions[ i + 1 ], buffer.positions[ i + 2 ] ) );
				geometry.vertexNormals.push( new p5.Vector( buffer.normals[ i ], buffer.normals[ i + 1 ], buffer.normals[ i + 2 ] ) );

			}

			geometry.vertexColors = buffer.colors;

			// faces stay empty: model() then draws the triangles with drawArrays and skips
			// generating stroke edges, which is slow and memory hungry for large scenes

			return geometry;

		}

		// check version (only 2.0 is supported)

		if ( data.indexOf( '#VRML V2.0' ) === - 1 ) {

			throw Error( 'VRMLLexer: Version of VRML asset not supported.' );

		}

		return parseTree( generateVRMLTree( data ) );

	}

}

class VRMLLexer {

	constructor( tokens ) {

		this.lexer = new chevrotain.Lexer( tokens );

	}

	lex( inputText ) {

		const lexingResult = this.lexer.tokenize( inputText );

		if ( lexingResult.errors.length > 0 ) {

			console.error( lexingResult.errors );

			throw Error( 'VRMLLexer: Lexing errors detected.' );

		}

		return lexingResult;

	}

}

const CstParser = chevrotain.CstParser;

class VRMLParser extends CstParser {

	constructor( tokenVocabulary ) {

		super( tokenVocabulary );

		const $ = this;

		const Version = tokenVocabulary[ 'Version' ];
		const LCurly = tokenVocabulary[ 'LCurly' ];
		const RCurly = tokenVocabulary[ 'RCurly' ];
		const LSquare = tokenVocabulary[ 'LSquare' ];
		const RSquare = tokenVocabulary[ 'RSquare' ];
		const Identifier = tokenVocabulary[ 'Identifier' ];
		const RouteIdentifier = tokenVocabulary[ 'RouteIdentifier' ];
		const StringLiteral = tokenVocabulary[ 'StringLiteral' ];
		const HexLiteral = tokenVocabulary[ 'HexLiteral' ];
		const NumberLiteral = tokenVocabulary[ 'NumberLiteral' ];
		const TrueLiteral = tokenVocabulary[ 'TrueLiteral' ];
		const FalseLiteral = tokenVocabulary[ 'FalseLiteral' ];
		const NullLiteral = tokenVocabulary[ 'NullLiteral' ];
		const DEF = tokenVocabulary[ 'DEF' ];
		const USE = tokenVocabulary[ 'USE' ];
		const ROUTE = tokenVocabulary[ 'ROUTE' ];
		const TO = tokenVocabulary[ 'TO' ];
		const NodeName = tokenVocabulary[ 'NodeName' ];

		$.RULE( 'vrml', function () {

			$.SUBRULE( $.version );
			$.AT_LEAST_ONE( function () {

				$.SUBRULE( $.node );

			} );
			$.MANY( function () {

				$.SUBRULE( $.route );

			} );

		} );

		$.RULE( 'version', function () {

			$.CONSUME( Version );

		} );

		$.RULE( 'node', function () {

			$.OPTION( function () {

				$.SUBRULE( $.def );

			} );

			$.CONSUME( NodeName );
			$.CONSUME( LCurly );
			$.MANY( function () {

				$.SUBRULE( $.field );

			} );
			$.CONSUME( RCurly );

		} );

		$.RULE( 'field', function () {

			$.CONSUME( Identifier );

			$.OR2( [
				{ ALT: function () {

					$.SUBRULE( $.singleFieldValue );

				} },
				{ ALT: function () {

					$.SUBRULE( $.multiFieldValue );

				} }
			] );

		} );

		$.RULE( 'def', function () {

			$.CONSUME( DEF );
			$.OR( [
				{ ALT: function () {

					$.CONSUME( Identifier );

				} },
				{ ALT: function () {

					$.CONSUME( NodeName );

				} }
			] );

		} );

		$.RULE( 'use', function () {

			$.CONSUME( USE );
			$.OR( [
				{ ALT: function () {

					$.CONSUME( Identifier );

				} },
				{ ALT: function () {

					$.CONSUME( NodeName );

				} }
			] );

		} );

		$.RULE( 'singleFieldValue', function () {

			$.AT_LEAST_ONE( function () {

				$.OR( [
					{ ALT: function () {

						$.SUBRULE( $.node );

					} },
					{ ALT: function () {

						$.SUBRULE( $.use );

					} },
					{ ALT: function () {

						$.CONSUME( StringLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( HexLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( NumberLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( TrueLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( FalseLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( NullLiteral );

					} }
				] );


			} );

		} );

		$.RULE( 'multiFieldValue', function () {

			$.CONSUME( LSquare );
			$.MANY( function () {

				$.OR( [
					{ ALT: function () {

						$.SUBRULE( $.node );

					} },
					{ ALT: function () {

						$.SUBRULE( $.use );

					} },
					{ ALT: function () {

						$.CONSUME( StringLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( HexLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( NumberLiteral );

					} },
					{ ALT: function () {

						$.CONSUME( NullLiteral );

					} }
				] );

			} );
			$.CONSUME( RSquare );

		} );

		$.RULE( 'route', function () {

			$.CONSUME( ROUTE );
			$.CONSUME( RouteIdentifier );
			$.CONSUME( TO );
			$.CONSUME2( RouteIdentifier );

		} );

		this.performSelfAnalysis();

	}

}

// triangles of a single geometry node, in its local space

class MeshData {

	constructor( creaseAngle ) {

		this.positions = []; // x, y, z per triangle corner
		this.keys = []; // per corner; corners with equal keys may share a smoothed normal
		this.colors = null; // optional r, g, b per corner
		this.creaseAngle = creaseAngle;

	}

	addTriangle( a, b, c, keyA, keyB, keyC ) {

		this.positions.push( a[ 0 ], a[ 1 ], a[ 2 ], b[ 0 ], b[ 1 ], b[ 2 ], c[ 0 ], c[ 1 ], c[ 2 ] );
		this.keys.push( keyA, keyB, keyC );

	}

}

// world-space triangles waiting to become a p5.Geometry

class MeshBuffer {

	constructor() {

		this.positions = [];
		this.normals = [];
		this.colors = []; // r, g, b, a per vertex, as p5.Geometry.vertexColors expects

	}

}

// order: corner order within each triangle, [ 0, 2, 1 ] to flip the winding

function computeNormals( positions, keys, creaseAngle, order ) {

	const triangleCount = positions.length / 9;
	const faceNormals = new Float32Array( triangleCount * 3 );

	for ( let t = 0; t < triangleCount; t ++ ) {

		const a = ( t * 3 + order[ 0 ] ) * 3, b = ( t * 3 + order[ 1 ] ) * 3, c = ( t * 3 + order[ 2 ] ) * 3;

		const abx = positions[ b ] - positions[ a ], aby = positions[ b + 1 ] - positions[ a + 1 ], abz = positions[ b + 2 ] - positions[ a + 2 ];
		const acx = positions[ c ] - positions[ a ], acy = positions[ c + 1 ] - positions[ a + 1 ], acz = positions[ c + 2 ] - positions[ a + 2 ];

		const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
		const length = Math.hypot( nx, ny, nz ) || 1;

		faceNormals[ t * 3 ] = nx / length;
		faceNormals[ t * 3 + 1 ] = ny / length;
		faceNormals[ t * 3 + 2 ] = nz / length;

	}

	const normals = new Float32Array( positions.length );

	if ( creaseAngle <= 0 ) {

		for ( let i = 0, l = keys.length; i < l; i ++ ) {

			const t = Math.floor( i / 3 );

			normals[ i * 3 ] = faceNormals[ t * 3 ];
			normals[ i * 3 + 1 ] = faceNormals[ t * 3 + 1 ];
			normals[ i * 3 + 2 ] = faceNormals[ t * 3 + 2 ];

		}

		return normals;

	}

	// as in three.js: average the normals of the faces sharing a vertex, unless
	// they meet the corner's own face at an angle of creaseAngle or more

	const cosCrease = Math.cos( creaseAngle );
	const facesByKey = new Map();

	for ( let i = 0, l = keys.length; i < l; i ++ ) {

		let faces = facesByKey.get( keys[ i ] );

		if ( faces === undefined ) facesByKey.set( keys[ i ], faces = [] );

		faces.push( Math.floor( i / 3 ) );

	}

	for ( let i = 0, l = keys.length; i < l; i ++ ) {

		const t = Math.floor( i / 3 );
		const fx = faceNormals[ t * 3 ], fy = faceNormals[ t * 3 + 1 ], fz = faceNormals[ t * 3 + 2 ];

		let x = 0, y = 0, z = 0;

		for ( const u of facesByKey.get( keys[ i ] ) ) {

			const ux = faceNormals[ u * 3 ], uy = faceNormals[ u * 3 + 1 ], uz = faceNormals[ u * 3 + 2 ];

			if ( ux * fx + uy * fy + uz * fz > cosCrease ) {

				x += ux;
				y += uy;
				z += uz;

			}

		}

		const length = Math.hypot( x, y, z ) || 1;

		normals[ i * 3 ] = x / length;
		normals[ i * 3 + 1 ] = y / length;
		normals[ i * 3 + 2 ] = z / length;

	}

	return normals;

}

// 4x4 matrices, column-major

const IDENTITY = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];

function mat4Multiply( a, b ) {

	const out = new Array( 16 );

	for ( let col = 0; col < 4; col ++ ) {

		for ( let row = 0; row < 4; row ++ ) {

			out[ col * 4 + row ] =
				a[ row ] * b[ col * 4 ] +
				a[ 4 + row ] * b[ col * 4 + 1 ] +
				a[ 8 + row ] * b[ col * 4 + 2 ] +
				a[ 12 + row ] * b[ col * 4 + 3 ];

		}

	}

	return out;

}

function mat4Translation( x, y, z ) {

	return [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1 ];

}

function mat4Scale( x, y, z ) {

	return [ x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1 ];

}

function mat4Rotation( x, y, z, angle ) {

	const length = Math.hypot( x, y, z );

	if ( length === 0 || angle === 0 ) return IDENTITY;

	x /= length;
	y /= length;
	z /= length;

	const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;

	return [
		t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
		t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
		t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
		0, 0, 0, 1
	];

}

function mat4Determinant3( m ) {

	return m[ 0 ] * ( m[ 5 ] * m[ 10 ] - m[ 9 ] * m[ 6 ] ) -
		m[ 4 ] * ( m[ 1 ] * m[ 10 ] - m[ 9 ] * m[ 2 ] ) +
		m[ 8 ] * ( m[ 1 ] * m[ 6 ] - m[ 5 ] * m[ 2 ] );

}

function transformPoints( points, m ) {

	const out = new Float32Array( points.length );

	for ( let i = 0, l = points.length; i < l; i += 3 ) {

		const x = points[ i ], y = points[ i + 1 ], z = points[ i + 2 ];

		out[ i ] = m[ 0 ] * x + m[ 4 ] * y + m[ 8 ] * z + m[ 12 ];
		out[ i + 1 ] = m[ 1 ] * x + m[ 5 ] * y + m[ 9 ] * z + m[ 13 ];
		out[ i + 2 ] = m[ 2 ] * x + m[ 6 ] * y + m[ 10 ] * z + m[ 14 ];

	}

	return out;

}

export { VRMLLoader };
