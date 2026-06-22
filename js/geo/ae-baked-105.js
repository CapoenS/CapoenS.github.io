// Albian, Early Cretaceous (~105 Ma) paleogeography — improved hand-built
// approximation after GPlates/PALEOMAP-style reconstructions, used as
// offline fallback when the GPlates Web Service is unreachable.
// Age-specific details: equatorial Atlantic just opening (SA almost touches
// Africa), Western Interior Seaway a deep gulf from the Arctic (not yet a
// full split), Greenland still bridging NA toward Europe, India STILL joined
// to Madagascar (separation ~88 Ma), Australia still joined to Antarctica.
window.AE_BAKED_105 = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "North America + Greenland" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-105,24],[-114,28],[-122,34],[-128,42],[-132,50],[-135,58],[-133,64],[-126,70],
        [-118,73],[-108,74],[-98,74],
        [-99,68],[-101,60],[-102,52],[-100,46],[-96,43],
        [-92,47],[-90,54],[-88,62],[-87,70],[-85,74],
        [-75,77],[-60,79],[-45,80],[-32,79],[-22,76],[-18,72],
        [-24,68],[-32,64],[-40,60],[-46,56],[-52,50],
        [-56,44],[-60,38],[-66,32],[-74,28],[-84,25],[-94,23],[-105,24]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Asia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [58,72],[72,76],[88,78],[104,74],[118,68],[130,62],[140,56],[148,48],
        [144,40],[136,32],[128,24],[118,16],[108,10],[98,8],[92,14],[86,20],
        [78,24],[68,26],[60,30],[54,38],[52,48],[52,58],[54,66],[58,72]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Fennoscandia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [8,58],[18,56],[30,58],[40,64],[42,70],[34,74],[22,74],[12,68],[6,62],[8,58]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Iberia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-14,32],[-6,34],[0,30],[-8,27],[-14,29],[-14,32]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Central Europe island" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [10,44],[18,46],[24,42],[16,39],[10,44]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Africa + Arabia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-12,24],[-4,27],[6,28],[16,26],[26,28],[36,29],[44,25],[52,21],[56,15],
        [50,11],[46,3],[48,-5],[44,-13],[40,-21],[34,-29],[26,-36],[16,-38],
        [8,-33],[2,-25],[-6,-17],[-10,-7],[-14,3],[-17,13],[-12,24]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "South America" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [-58,10],[-48,8],[-38,4],[-28,-2],[-30,-10],[-36,-18],[-42,-26],[-48,-34],
        [-54,-42],[-60,-50],[-66,-54],[-72,-50],[-74,-42],[-72,-32],[-70,-22],
        [-68,-12],[-64,-2],[-60,6],[-58,10]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "India + Madagascar" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [50,-18],[58,-14],[66,-16],[72,-22],[72,-30],[66,-38],[58,-42],[50,-40],
        [46,-32],[44,-24],[50,-18]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Antarctica + Australia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [0,-66],[30,-68],[58,-66],[85,-62],[105,-54],[114,-46],[126,-40],[140,-42],
        [150,-50],[156,-58],[164,-66],[-168,-68],[-135,-70],[-100,-68],[-70,-66],
        [-40,-67],[-15,-68],[0,-66]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Zealandia" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [166,-56],[172,-53],[178,-57],[172,-61],[166,-59],[166,-56]
      ]] }
    }
  ]
};
