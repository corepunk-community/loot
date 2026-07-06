#!/usr/bin/env ruby
# Build the merged World Map payload for the loot site: gathering nodes (../../World/trees)
# + all entity/landmark/harvest layers (../../World/npcs/data) -> worldmap_data.js.
# Each layer: {id, section, label, color, style, on, search, pts}. pts elements are
# [x,z] (plain) or [x,z,meta] where meta = kind (searchable) or name (labelled).
require 'json'
TREES = "C:/Users/benja/Documents/Games/Corepunk/Game/Content/World/trees"
NPCS  = "C:/Users/benja/Documents/Games/Corepunk/Game/Content/World/npcs/data"
OUT   = "C:/Users/benja/Documents/Games/Corepunk/Game/Content/Entities/loot/worldmap_data.js"

def items(f); JSON.parse(File.read(f))["items"] rescue []; end
rnd = ->(v){ v.round(1) }

layers = []
add = ->(h){ layers << h }

# ---- Gathering (from reworked tree_nodes.json professions) ----
tn = JSON.parse(File.read("#{TREES}/tree_nodes.json"))
prof = tn["professions"]
[["logging","Trees (logging)","#43c463"],["mining","Ore (mining)","#e3a13a"],
 ["herbalism","Plants (herbalism)","#b06fe0"]].each do |key,label,color|
  next unless prof[key]
  pts = prof[key]["nodes"].map{|n| [rnd.(n["x"]), rnd.(n["z"])] }
  add.({id:"gather_#{key}", section:"Gathering", label:label, color:color, style:"dot", on:false, search:false, pts:pts})
end

# ---- Creatures ----
cre = items("#{NPCS}/creatures.json")
CRE = {"monster"=>["Monsters","#f85149",true],"creep"=>["Creeps","#f0883e",true],
       "peaceful_animal"=>["Peaceful animals","#7ee787",false],"wild_animal"=>["Wild animals","#2dd4bf",false]}
CRE.each do |g,(label,color,srch)|
  pts = cre.select{|r| r["g"]==g}.map{|r| srch ? [rnd.(r["x"]),rnd.(r["z"]),r["k"]] : [rnd.(r["x"]),rnd.(r["z"])] }
  add.({id:"cre_#{g}", section:"Creatures", label:label, color:color, style:"dot", on:(g=="monster"), search:srch, pts:pts})
end
crit = items("#{NPCS}/critters.json").map{|r|[rnd.(r["x"]),rnd.(r["z"])]}
add.({id:"critters", section:"Creatures", label:"Ambient critters", color:"#6e7681", style:"dot", on:false, search:false, pts:crit})

# ---- NPCs ----
fn = items("#{NPCS}/friendly_npcs.json").map{|r|[rnd.(r["x"]),rnd.(r["z"]),r["name"]]}
add.({id:"friendly_npcs", section:"NPCs", label:"Friendly NPCs (named)", color:"#2dd4bf", style:"dot", on:true, search:true, pts:fn})
npc = items("#{NPCS}/npcs.json")
# 'miner' is actually ORE / mining harvest nodes (Steppes + Rivergleam mining zones, @PHOGS@ gather
# blueprint) — NOT NPCs. User-confirmed in-game. So it belongs in Gathering, not NPCs.
add.({id:"gather_miner", section:"Gathering", label:"Ore nodes (miner)", color:"#d98a2b", style:"dot",
      on:false, search:false, pts:npc.select{|r|r["g"]=="miner"}.map{|r|[rnd.(r["x"]),rnd.(r["z"])]}})
add.({id:"npc_guard", section:"NPCs", label:"Guards", color:"#d2a8ff", style:"star",
      on:false, search:false, pts:npc.select{|r|r["g"]=="guard"}.map{|r|[rnd.(r["x"]),rnd.(r["z"])]}})

# ---- Bosses ----
# (Troll Sites layer removed — the trolls are instanced; only an arena door + 2 scarecrow props
#  were ever on the open map, which isn't useful here.)
# The generic 'wandering-monsters' spawns are the roaming ARMORED HYENA elites: 97% overlap the
# regular hyena population's footprint in the Steppes (centroids ~identical), matching in-game sightings.
rb = (JSON.parse(File.read("#{NPCS}/wandering_bosses.json"))["groups"] rescue []).select{|g|g["kind"]=="wandering-monsters"}.flat_map{|g|(g["points"]||[]).map{|p|[rnd.(p[0]),rnd.(p[1]),"Armored hyena (wandering elite)"]}}
add.({id:"roaming_bosses", section:"Bosses & harvest", label:"Armored hyenas (wandering, Steppes)", color:"#f43f5e", style:"star", on:true, search:false, pts:rb})

# ---- Harvestable (rings) ----
HC = {"dragon"=>"#22d3ee","hyena"=>"#f59e0b","golem"=>"#a78bfa","archosaur"=>"#84cc16",
      "boarmammoth"=>"#fb923c","boar"=>"#fdba74","wolves|wolf"=>"#e5e7eb","bear"=>"#b45309"}
(JSON.parse(File.read("#{NPCS}/harvestable.json"))["harvestable"] rescue []).each do |h|
  sp=h["species"]; col=HC[sp]||"#22d3ee"
  add.({id:"harv_#{sp.tr('|','_')}", section:"Bosses & harvest", label:"Harvest: #{sp.sub('wolves|wolf','wolves').capitalize} — #{h["resource"]}",
        color:col, style:"ring", on:(sp=="dragon"), search:false, pts:(h["points"]||[]).map{|p|[rnd.(p[0]),rnd.(p[1])]}})
end

# ---- Quest ----
q = items("#{NPCS}/quest_objects.json")
{"quest_object"=>["Quest objects","#ffd33d"],"quest_searchable"=>["Quest corpses","#ffab70"]}.each do |g,(label,color)|
  pts=q.select{|r|r["g"]==g}.map{|r|[rnd.(r["x"]),rnd.(r["z"]),r["k"]]}
  add.({id:"q_#{g}", section:"Quest", label:label, color:color, style:"star", on:true, search:true, pts:pts})
end

# ---- Objects ----
chest=items("#{NPCS}/chests.json").map{|r|[rnd.(r["x"]),rnd.(r["z"])]}
add.({id:"chests", section:"Objects", label:"Chests", color:"#facc15", style:"dot", on:false, search:false, pts:chest})
stn=items("#{NPCS}/stations.json")
add.({id:"cooking", section:"Objects", label:"Cooking / craft stations", color:"#f87171", style:"star", on:false, search:false, pts:stn.select{|r|r["k"]=~/cook|craft/}.map{|r|[rnd.(r["x"]),rnd.(r["z"])]}})
add.({id:"campfires", section:"Objects", label:"Campfires / torches", color:"#fb923c", style:"dot", on:false, search:false, pts:stn.select{|r|r["k"]=~/fire|torch|wood/}.map{|r|[rnd.(r["x"]),rnd.(r["z"])]}})
wo = items("#{NPCS}/world_objects.json")
{"searchable"=>["Searchable","#a371f7"],"destroyable"=>["Destroyable","#c08040"],
 "reactive"=>["Reactive props","#4d5b7c"],"searchable_corpse"=>["Searchable corpses","#bc8cff"],
 "shrine"=>["Shrines","#ec6cb9"],"soulkeeper"=>["Soulkeepers","#f0f6fc"]}.each do |g,(label,color)|
  pts=wo.select{|r|r["g"]==g}.map{|r|[rnd.(r["x"]),rnd.(r["z"]),r["k"]]}
  add.({id:"obj_#{g}", section:"Objects", label:label, color:color, style:(%w[shrine soulkeeper].include?(g) ?"star":"dot"), on:false, search:true, pts:pts})
end

# ---- region labels — centroids from creatures.json `reg` (covers every zone incl. Steppes/Suncrest) ----
DISPLAY = {"goldenfield-town"=>"Goldenfield Town","westwind-woods"=>"Westwind Woods","windreach-woods"=>"Windreach Woods",
  "dusktide-forest"=>"Dusktide Forest","sunweave-glade"=>"Sunweave Glade","tempest-timberland"=>"Tempest Timberland",
  "starbark-groves"=>"Starbark Groves","riverrise-swamp"=>"Riverrise Swamp","skylight-grasslands"=>"Skylight Grasslands",
  "ripplecrop-fields"=>"Ripplecrop Fields","suncrest-fields"=>"Suncrest Fields","suncrest"=>"Suncrest Fields",
  "steppes"=>"The Steppes","rivergleam"=>"Rivergleam",
  "riverrise"=>"Riverrise Swamp","swamp"=>"Riverrise Swamp","creepping-marsh"=>"Creeping Marsh"}
agg = Hash.new{|h,k| h[k]=[0.0,0.0,0]}
cre.each{|r| next unless r["reg"]; a=agg[r["reg"]]; a[0]+=r["x"]; a[1]+=r["z"]; a[2]+=1 }
seen = {}
regions = agg.select{|k,v| DISPLAY[k] && v[2]>=20}.map{|k,v| [DISPLAY[k], (v[0]/v[2]).round, (v[1]/v[2]).round]}
  .reject{|name,x,z| seen[name] ? true : (seen[name]=true; false)}
  .map{|name,x,z| {name:name, x:x, z:z}}

payload = { world: tn["world"], regions: regions, layers: layers }
File.write(OUT, "window.WORLD_DATA=" + JSON.generate(payload) + ";")
mb = (File.size(OUT)/1024.0/1024).round(2)
puts "layers=#{layers.size}  total points=#{layers.sum{|l|l[:pts].size}}  -> worldmap_data.js (#{mb} MB)"
layers.group_by{|l|l[:section]}.each{|s,ls| puts "  #{s}: #{ls.map{|l| "#{l[:label].split(' ').first}(#{l[:pts].size})"}.join(' ')}"}
