var express = require('express'),
    app = express(),
    server = require('http').createServer(app),
    sanitizer = require('sanitizer'),
    io = require('socket.io').listen(server, {
        'log level' : 2
    }),
    formidable = require('formidable'),
    path = require('path'),
    fs = require('fs'),
    mediaserver = require('mediaserver'),
    multer = require('multer');

const port = process.env.PORT || 3000;
server.listen(port);

app.use(express.static(__dirname + '/public'));

app.get('/public', function (req, res) {
    res.sendfile(__dirname + '/public/index.html');
});

var usuarios = []; //Array con los nombres de usuarios.
var jugadores = []; //Array con los nombres de los jugadores
var tablero = ['','','','','','','','',''];//Estado del tablero
var turno = false; //Indica el jugador al que le toca jugar
var jugadas = 0; //Contador de jugadas para saber cuando declarar empate.
var puntos = 0;//Contador de puntos de cada jugador

//Devuelve la figura del jugador.
var figura = function( jugador ){
    var figuras = ['X','O'];
    return figuras[jugador-1];
};

//Se comprueban todas las jugadas posibles
var comprobarTablero = function( tablero ){

    var r = false, t = tablero;

    if( (t[0] == t[1]) && (t[0] == t[2]) && (t[0] !== '') ){ //Primera fila
        r = true;
    }else if( (t[3] == t[4]) && (t[3] == t[5]) && (t[3] !== '') ){ //Segunda fila
        r = true;
    }else if( (t[6] == t[7]) && (t[6] == t[8]) && (t[6] !== '') ){ //Tercera fila
        r = true;
    }else if( (t[0] == t[3]) && (t[0] == t[6]) && (t[0] !== '') ){ //Primera columna
        r = true;
    }else if( (t[1] == t[4]) && (t[1] == t[7]) && (t[1] !== '') ){ //Segunda columna
        r = true;
    }else if( (t[2] == t[5]) && (t[2] == t[8]) && (t[2] !== '') ){ //tercera columna
        r = true;
    }else if( (t[0] == t[4]) && (t[0] == t[8]) && (t[0] !== '') ){ //Primera diagonal
        r = true;
    }else if( (t[6] == t[4]) && (t[6] == t[2]) && (t[6] !== '') ){ //Segunda diagonal
        r = true;
    }

    return r;

};

//Cuando se conecta un usuario
io.sockets.on('connection', function (socket) {

    var desconectarAmbosJugadores = function(){
        jugadores = [];
        tablero = ['','','','','','','','',''];
        turno = false;
        jugadas = 0;
        io.sockets.emit('desconectarAmbosJugadores', true);

        for(var i in io.sockets.sockets){

            if(io.sockets.sockets[i].jugador){
                delete io.sockets.sockets[i].jugador;
            }
        }
    };

    
    socket.emit('conexion', {'jugadores' : jugadores, 'tablero' : tablero});


    //Se comprueba el nombre de usuario
    socket.on('comprobarUsuario',function(data, callback){

        data = sanitizer.escape(data);

        //Se comprueba que no está en uso
        if(usuarios.indexOf(data) >= 0){
            callback({ok : false, msg : 'Este nombre esta ocupado'});
        }else{

            //se envia al usuario
            callback({ok : true, nick : data});
            socket.nick = data;
            usuarios.push(data);
            console.log('Usuario conectado: ' + socket.nick);

            //se envian a todos los usuarios que se ha unido uno nuevo.
            io.sockets.emit('nuevoUsuario', {nick : data, listaUsuarios : usuarios, puntuacion:puntos});
        }

    });


    socket.on('nuevoJugador', function(data, callback){

        if(jugadores.length < 2 && !socket.jugador ){
            jugadores.push(socket.nick);
            callback({ok : true, 'jugador' : jugadores.length});
            socket.jugador = jugadores.length;
            io.sockets.emit('nuevoJugador', {nick : socket.nick, 'jugador' : jugadores.length, puntuacion:puntos});

            //Si hay dos jugadores se empieza la partida empezando el primero.
            if(jugadores.length == 2){
                turno = 1;
                io.sockets.emit('turno', {'turno' : 1, 'tablero' : tablero});
            }
        }

    });

   
    socket.on('marcarCelda', function(data){
        if(socket.jugador == turno && tablero[data] === ''){
            tablero[data] = figura(turno);
            jugadas++;

          
            if(comprobarTablero(tablero)){
                io.sockets.emit('turno', {'turno' : turno, 'tablero' : tablero, 'ganador' : jugadores[turno-1],puntuacion: puntos+50});
                desconectarAmbosJugadores();

            }else if(jugadas == 9){ //Empate
                io.sockets.emit('turno', {'turno' : turno, 'tablero' : tablero, 'empate' : true, 'jugadores' : jugadores});
                desconectarAmbosJugadores();

            }else{
                turno = (turno == 1) ? 2 : 1;
                io.sockets.emit('turno', {'turno' : turno, 'tablero' : tablero,puntuacion:puntos+10});
            }

        }
    });

  
    socket.on('msg', function (data) {
        data.msg = sanitizer.escape(data.msg);
        io.sockets.emit('msg', data);
    });


    //Cuando un usuario se desconecta se comprueba que estaba en el chat, y se informa y actualiza la lista del resto de usuarios.
    socket.on('disconnect', function(){

        if( socket.nick ){
            usuarios.splice(usuarios.indexOf(socket.nick), 1);
            io.sockets.emit('desconectarUsuario', {nick : socket.nick, listaUsuarios : usuarios});
            console.log('usuario desconectado: ' + socket.nick);

            //Si era un jugador en activo sacan ambos de la partida
            if(socket.jugador){
                if(jugadores.length == 2){

                    desconectarAmbosJugadores();

                }else{ //Si estaba solo en la partida eliminamos su nombre de la partida

                    jugadores.splice(jugadores.indexOf(socket.nick), 1);
                    io.sockets.emit('desconectarJugador', {nick : socket.nick, jugador : socket.jugador});
                }
            }

        }

    });

});

//Subida de archivos a la carpeta uploads

app.get('/', function (req, res){
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/', function (req, res){
    var form = new formidable.IncomingForm();

    form.parse(req);

    form.on('fileBegin', function (name, file){
        file.path = __dirname + '/uploads/' + file.name;
    });

    form.on('file', function (name, file){
        console.log('Uploaded ' + file.name);
    });

    res.sendFile(__dirname + 'public/index.html');
});

//Subida de audio con reproductor

var opcionesMulter = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'canciones'));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
});

var upload = multer({storage: opcionesMulter});

app.use(express.static('public'));
var ruta = path.join(__dirname, 'node_modules', 'jquery', 'dist');
app.use('/jquery', express.static(ruta));

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, '/public/index.html'));
});

app.get('/canciones', function(req, res) {
  fs.readFile(path.join(__dirname, 'canciones.json'), 'utf8', function(err, canciones) {
    if (err) throw err;
    res.json(JSON.parse(canciones));
  })
});

app.get('/canciones/:nombre', function(req, res) {
  var cancion = path.join(__dirname, 'canciones', req.params.nombre);
  mediaserver.pipe(req, res, cancion);
});

app.post('/canciones', upload.single('cancion'), function(req, res) {
  var archivoCanciones = path.join(__dirname, 'canciones.json');
  var nombre = req.file.originalname;
  fs.readFile(archivoCanciones, 'utf8', function(err, archivo) {
    if (err) throw err;
    var canciones = JSON.parse(archivo);
    canciones.push({nombre: nombre});
    fs.writeFile(archivoCanciones, JSON.stringify(canciones), function(err) {
      if (err) throw err;
      res.sendFile(path.join(__dirname, 'public/index.html'));
    })
  });
});
