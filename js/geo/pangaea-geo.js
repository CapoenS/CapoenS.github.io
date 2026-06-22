// Late Triassic (~220 Ma) paleogeography, simplified from PALEOMAP-style
// plate reconstructions (C.R. Scotese). Coordinates are paleo-lat/lon.
// Features: Pangaea mainland (Laurasia + Gondwana, Tethys re-entrant),
// Cimmerian terranes mid-Tethys, South China + North China blocks.
window.PANGAEA = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Pangaea" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [75,72],[88,74],[98,73],[108,69],[114,63],[118,56],[123,50],[126,44],[120,40],[114,36],
          [106,33],[97,31],[88,30],[79,27],[70,25],[61,23],[53,21],[46,17],[40,12],[35,7],
          [31,2],[34,-4],[41,-7],[49,-10],[57,-13],[65,-15],[73,-17],[81,-18],[89,-21],[97,-23],
          [105,-26],[112,-29],[120,-30],[129,-31],[138,-33],[147,-37],[152,-44],[149,-52],[141,-58],[131,-62],
          [119,-66],[105,-71],[88,-75],[68,-79],[45,-81],[22,-80],[3,-76],[-12,-70],[-24,-64],[-36,-58],
          [-47,-51],[-56,-43],[-63,-34],[-67,-25],[-64,-16],[-59,-8],[-56,0],[-53,8],[-58,16],[-63,24],
          [-60,32],[-52,38],[-44,44],[-34,49],[-22,53],[-9,56],[3,58],[15,61],[27,63],[39,66],
          [52,69],[63,71],[75,72]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Cimmeria-W" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [50,-4],[57,-2],[64,0],[63,-4],[56,-7],[50,-4]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Cimmeria-C" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [72,1],[80,4],[88,7],[87,2],[79,-1],[72,1]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Cimmeria-E" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [96,8],[105,12],[112,15],[110,9],[101,6],[96,8]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "South China" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [122,17],[129,21],[134,26],[129,28],[121,22],[122,17]
      ]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "North China" },
      "geometry": { "type": "Polygon", "coordinates": [[
        [128,33],[135,36],[139,40],[133,42],[126,37],[128,33]
      ]] }
    }
  ]
};
