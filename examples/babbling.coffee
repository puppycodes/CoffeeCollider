# origin: SuperCollider/examples/demonstrations/babbling brook.scd

# /*
# A babbling brook example, by James McCartney 2007. See
# http://www.create.ucsb.edu/pipermail/sc-users/2007-April/033231.html
# */

(->
  a = (->
    RHPF.ar(OnePole.ar(BrownNoise.ar(), 0.99), LPF.ar(BrownNoise.ar(), 14) * 400 +  500, 0.03, 0.03)
  ).dup() + (->
    RHPF.ar(OnePole.ar(BrownNoise.ar(), 0.99), LPF.ar(BrownNoise.ar(), 20) * 800 + 1000, 0.03, 0.05)
  ).dup() * 4
).play()


# (
# {
# ({RHPF.ar(OnePole.ar(BrownNoise.ar, 0.99), LPF.ar(BrownNoise.ar, 14)
# * 400 + 500, 0.03, 0.003)}!2)
# + ({RHPF.ar(OnePole.ar(BrownNoise.ar, 0.99), LPF.ar(BrownNoise.ar, 20)
# * 800 + 1000, 0.03, 0.005)}!2)
# * 4
# }.play
# )
