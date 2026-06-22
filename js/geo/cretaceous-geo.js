// Late Cretaceous (~90 Ma, Cenomanian–Turonian) paleogeography, simplified
// from PALEOMAP-style plate reconstructions (C.R. Scotese). Peak sea level:
// North America split by the Western Interior Seaway (Laramidia/Appalachia),
// Europe an archipelago behind the Turgai Strait, Arabia still part of
// Africa, India + Madagascar adrift, Australia still joined to Antarctica.
// Coordinates are paleo-lat/lon.
window.CRETACEOUS = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Laramidia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-128,72],[-120,74],[-112,70],[-108,62],[-104,54],[-100,46],[-98,38],
        [-100,31],[-106,28],[-112,33],[-116,42],[-122,52],[-128,62],[-128,72]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Appalachia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-88,52],[-78,54],[-68,50],[-62,44],[-64,37],[-72,32],[-80,30],
        [-88,34],[-92,42],[-90,48],[-88,52]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Greenland" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-48,62],[-40,60],[-28,62],[-20,68],[-22,76],[-32,80],[-44,78],[-52,72],[-48,62]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Fennoscandia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [12,56],[22,54],[34,56],[44,62],[46,68],[38,72],[26,72],[16,68],[10,62],[12,56]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Iberia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-12,34],[-4,36],[0,32],[-6,29],[-12,31],[-12,34]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Bohemia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [14,44],[20,46],[24,42],[18,40],[14,44]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Asia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [62,70],[75,74],[92,76],[108,72],[120,66],[132,60],[140,52],[145,44],
        [140,36],[132,28],[124,20],[114,12],[104,8],[96,12],[90,18],[82,22],
        [72,24],[64,28],[58,36],[56,46],[56,56],[58,64],[62,70]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Africa-Arabia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-14,26],[-6,28],[4,29],[14,27],[24,29],[34,30],[42,26],[50,22],[54,16],
        [48,12],[44,4],[46,-4],[42,-12],[38,-20],[32,-28],[24,-36],[14,-38],
        [6,-32],[2,-24],[-4,-16],[-8,-6],[-12,4],[-16,14],[-14,26]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "South America" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-62,8],[-52,6],[-42,2],[-36,-6],[-38,-14],[-42,-22],[-48,-30],[-54,-38],
        [-60,-46],[-66,-50],[-72,-46],[-74,-38],[-72,-28],[-70,-18],[-68,-8],
        [-66,0],[-62,8]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "India" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [58,-18],[66,-16],[72,-20],[74,-28],[70,-36],[62,-38],[56,-32],[54,-24],[58,-18]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Madagascar" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [44,-26],[48,-24],[50,-30],[48,-36],[44,-34],[42,-30],[44,-26]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Antarctica-Australia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [0,-66],[30,-68],[60,-66],[90,-62],[110,-52],[118,-42],[130,-38],
        [142,-40],[150,-48],[155,-56],[160,-64],[-170,-66],[-140,-68],
        [-110,-66],[-80,-64],[-50,-66],[-20,-68],[0,-66]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Zealandia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [168,-52],[174,-50],[178,-54],[172,-58],[166,-56],[168,-52]
      ]] }
    }
  ]
};
