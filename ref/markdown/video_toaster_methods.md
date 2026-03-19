# NewTek Video Toaster Visual Effects: Implementation Guide

This document is a comprehensive guide to implementing the classic visual effects of the 1990s NewTek Video Toaster devices on a new platform. It combines general descriptions of standard effects with low-level implementation logic, data structures, and code extracted from the original Developer's Handbook.

## 1. General Switcher Digital Video Effects (DVEs)
*Source: Video Toaster 2 Manual, Glossary*

### Blinds
- **Source:** Video Toaster 2 Manual
- **Description:** An effect in which the video is divided into two or more vertical slats and compressed off or expanded on

### Push/Pull
- **Source:** Video Toaster 2 Manual
- **Description:** An effect where the source selected on the Preview Bus is comes onto the Program from one of the sides or

### Split
- **Source:** Video Toaster 2 Manual
- **Description:** An effect which divides the video signal in two pieces.

### Squeeze/Zoom
- **Source:** Video Toaster 2 Manual
- **Description:** An effect which shrinks, in the case of a squeeze, or expands, in the case of a zoom, the video equally in the

### Swap
- **Source:** Video Toaster 2 Manual
- **Description:** An effect which divides the video into two or more pieces which cross each other as they come on or leave

### Trails
- **Source:** Video Toaster 2 Manual
- **Description:** An effect which trails of moving video are left behind the affected image as it moves about on the screen.

### Trajectory
- **Source:** Video Toaster 2 Manual
- **Description:** An effect where the video is squeezed and appears to fly around the screen.

### Transporter
- **Source:** Video Toaster 2 Manual
- **Description:** An effect in which any object which moves in the image appears to be in a transporter beam.

### Tumble
- **Source:** Video Toaster 2 Manual
- **Description:** An effect where the affected video flips around a horizontal or vertical axis. Often accompanied by a trajectory. ..._..


## 2. Advanced Animated Effects (Developer Implementation Data)
*Source: Video Toaster Developers Handbook (1995)*

### Single Image Color Cycling Source/Encoder Fade FX (NEON BANDS)
- **Source:** Developers Handbook, pp. ~20-25
- **Concept:** A single 256-color hi-res interlaced image is used as the source. The Switcher manipulates palettes and masking layers to generate a smooth transition from Source 1 to Source 2, utilizing 4 levels of Fader control.

#### Implementation Description
```text

Single Image Color Cycling Source/Encoder!Fade FX (NEON BANDS)

In this effect, a single Amiga 256-color hi-res interlaced image is the source of all the action. The
Toaster smoothly changes its Main output from one video source to another as colors cycling through
the image successively induce different areas of one source to become more and more transparent to
the other video source. As part of the action we also see portions of the actual Amiga image as its
colors cycle. Obviously, since we see some Amiga graphics, the Encoder (discussed above) is
sometimes passed through AMUX or BMUX to the Fader. We also see a combination of the user-
selected Main and Preview sources with the encoded’ Amiga graphics at varying transparency (each
second source increasingly shows through the increasingly “transparent’ Encoder source). We might
guess that at any one pixel on the Main Toaster output’s display, we see the Fader mixing between
either the user-selected Sourcel (Vid1, Vid2, Framestore, etc.) or Source2 and the Encoder. We
might imagine that AMUX is being switched on the fly so that either of two Toaster video sources is
fed to the A side of the Fader and Encoder (Amiga graphics) is being fed continuously to the B side
of the Fader through the BMUX. Then the Fader is being manipulated to output varying
combinations of what comes through the two MUX’s.

That is indeed what is happening in this effect, and the colors on the Amiga graphics are being
manipulated so that their Amiga digital color bits control the Toaster’s video flows for this
combination of 3 sources of imagery to generate a smooth transition from Sourcel to Source2 on the
Toaster’s Main video output. The palette colors through which the Amiga image cycles have their
low-order bits set to manipulate the Toaster’s video signal flow in just the right way. Here’s how:

One of the color palette ‘bits’ in each color is used to force AMUX to select between Source! and
Source2. (Yes, Virginia, it does take 3 bits to select one of the 8 AMUX inputs to pass through to the
A side of the Fader, but the Toaster will take care of this automatically for our purposes. Since we
only wish to choose between the two sources selected on the Switcher Interface we can think of this
as a single bit while designing the effect. The Switcher software does indeed manipulate all three

5S
latch’ bits in the palette colors behind the scenes.) Encoder is ‘permanently’ selected on BMUX (that
is set up by the Toaster in a way which doesn’t require any on-the-fly input from Amiga image color
bits since it is not changing - more on that later but *hint’ - remember the little mini-muxes which
control how AMUX and BMUX input selection takes place?), and two bits of each color are used to
vary the Fader’s level of mixing between its A and B inputs. Those two bits of Fader control let the
Fader show four levels of mixing between its A and B sides. Altogether, 3 different sources of video
are being mixed and the actual palette values assure that the mixing goes in an orderly way as the
different Amiga RGB color values cycle through the Amiga image’s palette. Obviously the initial
color palette positions in the Amiga image have color values which assure that ONLY Sourcel is
solidly on the Fader’s output and at the end of the color cycling the same image’s palette has color
values which assure that ONLY Source? is solidly on the Fader’s output. What happens in between
is that a ’longer’ palette of colors, is ’slid’ through the image’s palette (starting with all Amiga colors
having Source! control bits and ending with all Amiga colors having Source2 control bits) and the
intermediate colors in the long palette have various bits sets to manipulate the AMUX and the Fader.

This type of color cycling fade transition can only be used with an Amiga A4000 since it uses a 256-
color palette (really only 240 colors are actually used out of the 256-color palette, others are reserved
but more on that later). This is an ’AA-only’ effect. An Amiga A2000 can’t use this particular kind
of effect with so many smoothly changing colors because an A2000 is limited to hi-resolution images
of only 16 colors. An variation of this effect could be designed for an A2000 system but it would
have to conform to the limitations of the A2000’s color versus resolution tradeoffs. We’ll come back
to this effect later and show how to use its theory of operation to make similar ones of your own.

```

#### CrUD Source Code Structure
```asm

3CrUD source file for WIPE TWISTING NEON BANDS
;The following line is an assembler directive to merge in the tags.i assembly language include file of
jconstant values and names in the course of the ’make’ process conducted by SingleMake’s call to the
;PhxAss assembler. C programmers need not worry - there’s no assembly language to learn - the
jassembler is provided and called automatically by the SingleMake ’make’ script.

Include "tags.i"

CrUD_START CrUD_ILBMFX,CrUD_4_0
;The values of all the TAG_xxxx, AFXT_xxxx, and PACO_xxxx items are in the tags.i file. These
sparticular tags and their values are long word 32-bit numbers, but not all NewTek effects tags are
snecessarily 32-bit.

;Each TAG_ declaration below is actually a macro with one parameter, see the tags.i include file.
;Some ;of the TAG_xxxx macros have numerical values and some are Boolean (TRUE or FALSE).

;TAG_FCountMode can be 0, 1, 2, or 3. The value here of 2 means variable speed is supported for
;this ;effect. The next few tags are supporting individual speed values used when there really is a
;variable ;speed.

TAG_FCountMode 2

9
:TAG_VariableFCount is the variable frame count (speed) value.
TAG_VariableFCount 40

:TAG_SlowFCount is the number of frames to be used when this effect is played at SLOW speed.
TAG_SlowFCount 80

:TAG_MedFCount is the number of frames to play when this effect is in MEDIUM speed.
TAG_MedFCount 40

:TAG_FastFCount is the number of frames to play for this effect in FAST speed.
TAG_FastFCount 20

:TAG_Interlaced TRUE indicates the IFF ILBM used in this effect is interlaced.
TAG_Interlaced TRUE

:TAG_KeyMode here indicates that the Fader will be controlled by the DIB method (using 2 bits,

;four levels of Fader control between its AMUX and BMUX inputs). Note that the value
;AFXT_Key_4Level70ns is synonymous with AFXT_KeyDIB (see tags.i).

TAG_KeyMode AFXT_Key_4Level70ns

:TAG_Encoder TRUE means that Amiga graphics will appear on the BMUX for this effect. If we
sleft this out or made it FALSE, then the BMUX would get Toaster Matte color generator input
sinstead of Amiga graphics.

TAG_Encoder TRUE

:TAG_LatchAM TRUE means Amiga color palette bits will control the selection of video sources on
jthe AMUX.

TAG_LatchAM TRUE

;TAG_ButtonELHlogic is set to a value which tells the Toaster software how to manipulate the
sbehavior and appearance of the user interface buttons during the effect.

TAG_ButtonELHlogic AFXT_Logic_LatchAencoderB

:TABLE_PaletteColors is a structure macro which informs the effect how to manipulate and interpret
;Amiga palette colors during the effect.

TABLE _PaletteColors

;The PACO_NumberOfPalettes tells the effect that a total of 340 different color combinations will
soccur during this effect. The effect starts with one 240-color palette but that palette is replaced 340
stimes as successive colors in the table below are ‘slid’, one color at a time, into the Amiga palette for
sthis image. The extra palette counts were inserted here as the effect was created, to compensate for
;the ’widths’ of the several bands of color that create the soft edges. This allows the transitional
:values of the palette to cycle completely off the end of the color table, leaving the screen filled with a
;solid source.

de.w 240+12+32+12+32+12 sPACO_NumberOfPalettes
10
;This says the Amiga image palette colors will be replaced by shifting the whole palette by one
sposition during the cycling process (a new top color enters from the next value in the table below).

de.w 1 ;PACO_ColorsBetweenPalettes
snumber of colors between palettes
31 for moving pointer.

sThe initial palette will start at the zero position of the table below.

de.w 0 ;PACO_StartingColorNumber
;Ususally 0

3240 colors at a time will be used in the Amiga image’s palette. Remember that for 256-color effects,
3the top 16 colors of the palette are reserved for internal use by the Toaster.

de.w 240 ;sPACO_NumberOfColors
;Maximum of 240

;The following color table will be ’masked’ into the Amiga image’s palette in such a way that the bits
3in the color table’s palette entries will be used as ’mask’ values in the colors’ low bits to let the
;Toaster use them as controls for the AMUX source (Latch) and four Fader (DIB) levels without
ichanging the higher order bits that make up the palette values that are encoded into the colors used in
;the effect.

de.l PACO_Mask_Latch!PACO_Mask_DIB

sThis effect doesn’t require any additional palette masking control values so the following three
spositions in this structure are set to 0 (PACO_Mask_Nochange = 0, see tags.i.)

deb. 1 3,PACO_Mask_Nochange jother Masks not needed

3A block of 16 bytes at the end of a TABLE _PaletteColors structure is reserved for future use and
;filled with zeroes for now.

dcb.b 16,0 3Space reserved for the future

;The following color table starts with a set of 240 bit-manipulation entries which ALL are set to start
;the effect by having the entire Amiga image’s color palette “latch’ the user’s current Main video bus
;selection onto the AMUX and have the Fader set to 100% AMUX level. There are 240 long words
shere, each with the value of #$00000000 OR’d with the bit denoting Main bus ’latching’ on AMUX.
The #$00000000 value (0, zero) means that the Fader is at its zero position (100% on AMUX).
;Remember that this effect permits 4 levels of Fader control between AMUX video sources and the
;BMUX which is set to Encoder (Amiga graphics). We start the effect with the Fader set to show
jonly AMUX’s source - and that source will be the user’s selected Main video input.

* color table

deb.1 — 240,$00000000!PACO_CurrentMain
;As the color cycling begins, the first color which replaces the ’top’ Amiga palette entry is
;immediately below - and it has AMUX still “latched” to Main but now we’ve started to mix a small
;amount of the Amiga graphic by setting a value of 1 (#$00000001) to shift the Fader to 66.6%
sAMUX and 33.3% BMUX (which has Encoder selected).

deb.1 1,$00000001!PACO_CurrentMain

11
:The next two colors which get ’slid’ down into the top of the Amiga image’s palette also point the
;AMUX to the Main bus video input but now we’ve raised the Fader control level to 2 so we'll seea
smix of 33.3% AMUX (‘latched’ to the Main ;video) and 66.6% Amiga graphics wherever this
spalette color appears.

deb.1 2,$00000002!PACO_CurrentMain

:Now we find a series of three colors which will slide down into the top of the Amiga image’s palette
sin which the AMUX is still *latched’ to the Main video source, but we’ve now swung the Fader (the
:#$00000003 value) to 100% BMUX. That means that the Amiga image (Encoder source on BMUX)
scompletely covers any part of the display where these three colors are displayed. Now our palette
shas elements where the bottom 234 colors still show 100% AMUX Main video but the top 6 colors
sshow increasing levels of BMUX Encoder input. The top 6 colors ‘ramp’ up to show the Amiga
sgraphic.

deb.1 3,$00000003!PACO_CurrentMain

:The following three colors to be slid down into the Amiga palette also point 100% to the BMUxX, but
swe’ve switched the AMUX source (while it is really invisible for these colors) to the second video
;source (the replacement source to which the Toaster is switching).

deb.1 3,$00000003!PACO_CurrentOverLay

*,

;You can now see that the rest of the colors which slide through the Amiga palette have varying
scombinations of effects. They successively manipulate combinations of AMUX video sourcing
;(Main and Overlay) and mixing of the AMUX source video with the Amiga graphic Encoder signal
jon BMUX.

sIt is important to realize that the colors in this table don’t really become full Amiga image palette
sentries and that the Amiga palette entries don’t actually cycle at all. The values in this series of color
stable entries in the CrUD are just being used (sequentially) to readjust the effect of the low-order bits
sof each Amiga palette color on the Toaster’s video mixing hardware.

deb.1 2,$00000002!PACO_CurrentOverLay
deb.1 1,$00000001!PACO_CurrentOverLay

deb.1 32,$00000001!PACO_CurrentMain

deb.1 1,$00000001!PACO_CurrentMain
deb.1 2,$00000002!PACO_CurrentMain

deb.1 _3,$00000003!PACO_CurrentMain
deb.1 3,$00000003!PACO_CurrentOverLay

deb.1 2,$00000002!PACO_CurrentOverLay
deb.1 1,$00000001!PACO_CurrentOverLay

deb.1 32,$00000000!PACO_CurrentOverLay
deb.1 1,$00000001!PACO_CurrentMain

12
deb.1 2,$00000002!PACO_CurrentMain

deb.1 — 3,$00000003!PACO_CurrentMain
deb.1 —_3,$00000003!PACO_CurrentOverLay

deb. 2,$00000002!PACO_CurrentOverLay
deb.1 1,$00000001!PACO_CurrentOverLay

;The effect ends by sliding in a complete set of control-bit replacements for all 240 colors in the
;Amiga palette - wherein the Source2 (CurrentOverlay) video shows everywhere and has completely
sreplaced the original Main source

deb.1 240,$00000000!PACO_CurrentOverLay

;The following two macros are always found at the end of the CrUD source file, TABLE_END wraps
sup the TABLE _PaletteColors structure and CrUD_END wraps up the entire CrUD file.

TABLE_END
CrUD_END

```

### 4-Color Animated Source/Source Switch FX (CAMERA IRIS)
- **Source:** Developers Handbook, pp. ~25-30
- **Concept:** Simplest of the animated effects. Uses a 4-color palette to build an expanding/contracting shape mask.

#### Implementation Description
```text

4-Color Animated Source/Source Switch FX (CAMERA IRIS)

This type of effect is perhaps the simplest of the animated effects. A palette of only 4 colors is used
on the Amiga animation and only 3 of them play a role in the video switching. In the CAMERA IRIS
effect we first see Source! solidly on screen as a nearly solid black animation of the camera iris
slowly closes down around it and covers it up. As the iris opens again the Source2 video appears at
the screen’s center and expands from the center of the screen to reveal all of Source2. In this effect
the Fader is not moved at all - only the BMUX is rapidly switched between video sources under
control of the 3 of the animation’s palette colors.

For the first half of the animation, AMUX alternately selects Source! and the Toaster’s Matte
background color (set to black). These two sources are selected on AMUX according to two of the
colors in the animation. In this first half of the animation’s duration only 2 Amiga colors are in use in
the animation. One of them is a color that lets Sourcel show in the Iris’ center as it closes down, the
other selects the Toaster’s Matte background color on AMUX.

During the second half of the animation one of the Amiga’s colors is changed and that lets the
AMUX now select Source2 or Encoder Matte as its input. This portion of the animation has the
alternate color (the one which lets Source2 get selected on the AMUX) occupy the center of the Iris’

opening.

I’ve left out a tiny bit of this animation’s complexity since during the first half, there are really 3
sources of video alternately applied to AMUX by various pixels of the Amiga’s animation. There are
some thin lines in the animation which ALWAYS show the Source2 video, throughout the whole
animation, i.e. the color of the animation which lets Source2 become selected on the AMUX also
appears in a tiny portion of the animation - during both halves of the animation. During the second
half of the animation, only 2 colors are used as described above - causing switching of AMUX
between only the Source2 video and the Toaster’s Matte generator (set to black).

Remember, during this entire animation, the Fader simply sits with 100% of its output coming from
the AMUX and the AMUX does ALL the work by being controlled by 3 different Amiga animation
palette colors. We’ll also come back to this effect later to show how its theory of operation can be
exploited for effects of your own creation.


```

#### CrUD Source Code Structure
```asm

3CrUD Source File for CAMERA IRIS

sThe following line is an assembler directive to merge in the tags.i assembly language include file of
sconstant values and names in the course of the ’make’ process conducted by SingleMake’s call to the
sPhxAss assembler. C programmers need not worry - there’s no assembly language to learn - the
sassembler is provided and called automatically by the SingleMake ’make’ script.

Include "tags.i"

;CrUD_START is a macro which has two constant value arguments. The arguments specify what
skind of effect and the Toaster software revision - in this case Ct-UD_ANIMFX means this CrUD will
sbecome part of an animation effect and CrUD_4_0 specifies Toaster 4.0 software usage.

CrUD_START CrUD_ANIMFX,CrUD_4 0

sThe values of all the TAG_xxxx, AFXT_xxxx, and PACO_xxxx items are in the tags.i file. These
sparticular tags and their values are long word 32-bit numbers, but not all NewTek effects tags are
snecessarily 32-bit. Each TAG_ declaration below is actually a macro with one parameter, see the
;tags.i include file. Some of the TAG_xxxx macros have numerical values and some are Boolean
;(TRUE or FALSE).

13
:This indicates that this effect DOES have sound when the effect occurs at FAST speed (only) and its
;value (AFXT_AudioFast) indicates the sound is of unknown stereo or mono type.

TAG_AudioFastSamples AFXT_AudioFast
sThis indicates that the effect will turn off the Amiga’s audio filter
TAG_TumAudioFilterOff TRUE

;This indicates this effect can be used on Amiga 2000 Toaster systems (non-AGA or non-AA
jsystems).

TAG_NonAAeffect TRUE

-This item indicates that latching (AMUX or BMUX pixel-color-based video source selection) will be
jused in this effect for the BMUX.

TAG_LatchBM TRUE

:This item specifies the color generated by the Toaster’s Matte generator, in this case it will be pure
sblack.

TAG_MatteColor AFXT_Matte_Black

‘This item dictates the keying mode’ - how the Fader will be operated under palette color control. In
sthis case, the value of AFXT Key Fader means that the Fader will be under control of the CDAC 0-
37 bits. For this particular effect, those bits don’t change during the effect so this is simply one way
sof saying that no Fader operation takes place at all!

TAG_KeyMode AFXT_Key_Fader

:The ButtonELHLogic tags specify how drawn buttons on the user-interface will behave during the
seffect. There are a number of combinations of how Toaster user interface buttons get enabled,
sdisabled, and highlighted during and after an effect. This value is used to denote which combination
sof those button handling routines will be in force for this effect and also how the Toaster allocates
svarious of its control bits to handle internal video signal routing and mux controls

TAG_ButtonELHlogic AFXT_Logic_TSEab
;The following macro sets up a specific format for a palette color data structure which will be
jinterpreted by Toaster’s effects-running system. Whereas tags are used as required to specify the
snature of the effect, the following table always requires certain entries and will resemble this form in
sall CrUD source files. See tags.i for a complete description of the PaletteColors table. It also sets up
;the AMUX/BMUX/Fader control input routing in the Toaster.

TABLE_PaletteColors

:The first entry in the table indicates the palette in use will be compatible with non-AA systems
;(A2000) and that one palette is used throughout the entire effect (we're not color cycling here!).

de.w 1 ;PACO_NonAA_NumberOfPalettes

:The next entry sort of re-states that no cycling will take place, it means that there’s a zero color
scycling step size.

dc.w 0 ;PACO_NonAA_ColorsBetweenPalettes
14
This denotes that the palette used by the effect will start with the first color in the color palette, the 0
scolor.

de.w 0 ;PACO_NonAA_StartingColorNumber

;This states how many colors are in the palette - only 4.
de.w 4 ;PACO_NonAA_NumberOfColors

sThis tells the Toaster how to process the values in the color table below. See the above discussion of
show various bits in certain places in a color value can affect AMUX/BMUxX source selection (known
3as ‘latching’), etc. The color table provided below in the CrUD source file is deliberately
sconstruction without any real colors, but only certain bits activated which the Toaster will use to
;’mask’ into the actual colors from the original animation. The masking method used by this effect
smeans that all bit positions of the color values in the palette will be entirely REPLACED by the
svalues specified in the following table. Since the tag entries for these values only contain the low-
sorder control bits, the original palette from the anim will be replaced with a palette that appears
sentirely black on the Amiga RGB monitor but is filled with video sources or matte color on the Main
;Toaster output.

de.l PACO_Mask Replace
;There are three more long word slots in the PaletteColors table structure for additional MASKING
jinformation items. In this case, all three are simply set to 0 (the value of PACO_Mask_Nochange in
jthe tags.i file) and are not with this effect.
deb.1 3,PACO_Mask_Nochange
3The PaletteColors table ends with a block of 16 bytes which are reserved for possible future ;use.
deb.b 16,0 3space reserved for the future
* color table
;The 0 palette color goes entirely unused in this animation effect.
del $00000000

;The 1 palette color will be used to ’latch’ the BMUX to whatever video source the user has selected
son the Toaster’s Main video bus when the effect occurs; the ’CurrentMain’ source.

de.l $00000000+PACO_CurrentMain

;The 2 palette color will be used to ’latch’ the BMUX to whatever video source is set to replace the
sMain one, i.e. the source selected by the user on the Preview bus; the ’CurrentOverlay’.

del $00000000+PACO_CurrentOverLay

sThe 3 palette color will ’latch’ the Toaster’s Matte generator (already specified to be a black color by
sone of the tags earlier in this CrUD) to the BMUX. Note also that this value, PACO_EncoderMatte,
smeans EITHER the Encoder OR the Matte - and which will be used is taken care of by a tag ;earlier
sin the CrUD. Matte is the default so no tag was actually used to specify this. Had we wanted the
3Encoder to be used for PACO_EncoderMatte, we’d have had to specify TAG_Encoder TRUE in the
sabove set of tags for this CrUD.

del $00000000+PACO_EncoderMatte
15
;Now two macros to end the CrUD’s PaletteColors table structure, then finalize the CrUD (see tags.i)

TABLE_END
CrUD_END

```

### 4-Color Kiki Source/Matte/Source Wipe FX (BEAR)
- **Source:** Developers Handbook, p. ~30
- **Concept:** Similar to Camera Iris, but the animation reveals a matte color outline before fully transitioning to the new video source.

#### Implementation Description
```text
6
4Color Kiki Source/Matte/Source Wipe FX (BEAR)

This type of effect is produced in a way identical to the CAMERA IRIS effect, only the animation
moves across the screen instead of playing statically centered on the Amiga screen.

```

### Multi-Color Smooth-edged Animated Wipe FX (GIRAFFE)
- **Source:** Developers Handbook, pp. ~31-40
- **Concept:** Combines color cycling with moving 4-color wipes. Uses varying degrees of transparency along edges to combat NTSC artifacting.

#### Implementation Description
```text

Multi-Color Smooth-edged Animated Wipe FX (GIRAFFE)

This type of effect has features in common with both the color cycling static image (NEON) and the
simple 4-color moving or static animated wipe (CAMERA IRIS) described above. These wipes use a
full color palette (actually, 240 out of the 256-color full palette) and an Amiga animation, but these
animations have plenty of color and visual appeal beyond the simple shadow-like animation of
CAMERA IRIS or BEAR. This type of effect also makes use of varying degrees of transparency
between the A and B sources applied to AMUX and BMUX by swinging the Fader smoothly between
them. Like the NEON effect, the AMUX is switched pixel-by-pixel between two user-selected video
sources and the Amiga images are applied as the only source to the BMUX via its Encoder input.
The use of the Fader to show mixtures of the AMUX and BMUX signals lets us have smooth edges
around the borders of the animated object moving across the screen.

The GIRAFFE effect will serve as an example of this type of effect but there are many which are
created in a similar way, including a number of the wipes which have other objects in place of the
giraffe. Some of those related effects may use a scrolling image which is larger than the display area
instead of a regular Amiga animation (simpler when the image isn’t really changing like the giraffe
does) but the idea is the same.

Introducing a variable transparency or mixing (Fader control) along with the animation smoothly
anti-aliases edges on the animation’s Amiga (Encoder signal) graphics where they adjoin either the
Sourcel or Source2 video. This helps minimize jaggies along the edges of the Amiga animation and
NTSC video artifacting which can occur along sharp-edged color transitions.

This type of effect uses a non-cycling palette but the construction of the palette is peculiar because of
the method used to build the animation. The animation’s color palette has to include colors whose
bits force Fader levels and AMUX source variations like the NEON cycling effect’s varying palettes
do.

The construction of this type of Amiga animation is a 3-step affair. Three different animations are
actually merged into one (using a tool called BitPlay we'll meet shortly). One of the animations is a
simple two-color (a single Amiga bitplane) Amiga animation which is used in the end result to
specify the bit-control of the AMUX (selection of Sourcel or Source2 (remember that Source] is just
*whatever’ is on the Main buss, Source2 is whatever’ is on the Overlay buss - Source! is the
’CurrentMain’ and Source? is the ’CurrentOverlay’ - Source] is the ’from’ and Source? is the ’to’)
video inputs to the A side of the Fader). Another animation is a four-color (two bitplanes) Amiga
animation and it is used for the anti-aliasing variable-transparency edges of the Amiga graphics. The
third animation is a 32-color (5 bitplanes) Amiga animation, which becomes the Encoder video signal
on the BMUX’s side of the Fader. The 32-color animation is the original full-color GIRAFFE
animation. The original 32-color animation is made intentionally NOT to use the top two Amiga
colors (does NOT use Colors #30 and #31!). When BitPlay merges the three animations together, the
32-color Amiga animation’s colors are spread out into a palette of 256 colors (again, only 240 are
actually used with 16 reserved for specific Toaster internal use). Each of the Amiga animation’s
original 32 colors is spread into 8 sub-shades by the introduction of the 3 other bitplanes from the
other animations (1 bitplane for AMUX selection and 2 for Fader control). The top two colors (#’s
30 and 31) were not used in the original animation so that they become colors #240-255 when the
anim is manipulated by BitPlay and those colors need to be reserved for the Toaster’s own use.
Avoiding Colors #30 and 31 when making the original anim just assures that the top 16 colors of the
256-color anim created by BitPlay are left unused. The 8 subshades within a color group are nearly
indistinguishable visually, only a few low order color bits vary among them. They can be
distinguished when you examine frames of the composited animation after merging with BitPlay.

7
Now we need to exercise a bit of mental gymnastics to imagine how a single the effect of either a 1 or
0 in a pixel of one bitplane of an 8 bitplane Amiga graphic becomes reflected in an Amiga 256-color
palette. Let’s keep it simple and imagine that the bitplane in question is the low order bitplane. Ifa
1-bit is present in a pixel of that bitplane then it must be true that one of the odd-numbered colors in
the palette will be used for that pixel. Remember that when an Amiga graphic is made of 8 bitplanes
(only possible on an AGA Amiga, of course), the Amiga takes the 8 bits of a pixel which originate in
different bitplanes and uses that 8-bit value to select a color for that pixel from a table of 256 colors.
Now you can see why the presence of a 1-bit in a pixel’s low order bitplane will mean that some odd-
numbered color palette position is selected to color that pixel. If a 0-bit occurs in a pixel’s low order
bitplane then the color selected will be one of the even-numbered palette entries. The overall effect
of using a single bitplane of an Amiga animation to specify the Toaster’s AMUX video source for
each pixel on the Amiga screen is that all even-numbered colors in the palette table correspond to the
selection of one of AMUX’s possible video sources and odd-numbered colors in the palette table
correspond to the other AMUX choice.

Using a similar concept of how bitplanes #1 and #2 might combine to control the Fader level we can
see that various combinations of 1-bits and 0-bits in those particular bitplanes will correspond to
palette entries spaced at certain intervals in the palette. For example a 00 combination of bits in the
#1 and #2 bitplanes correspond to palette entry positions evenly divisible by 4. The BitPlay
animation merge utility actually does the positioning of palette positions in relation to bitplane bits
slightly differently. Here’s what BitPlay does:

BitPlane 2 BitPlane 1 = Combined BitPlane 0
4-level 4-level Fader 2-choice
Fader Control Fader Control Level AMUX Selection
0 0 = 0( 0%) 0
0 0 = 0( 0%) 1
0 1 = 1 ( 33%) 0
0 1 = 1 ( 33%) il
1 0 = 2 ( 67%) 0
1 0 = 2 ( 67%) 1
1 1 = 3 (100%) 0
1 1 = 3 (100%) il

BitPlay merges the bitplanes used for AMUX and Fader control and generates a palette positioning
order which is not strictly in increasing binary order - it pairs up possible Fader levels with both
possible AMUX source levels. The pattern of 8 successive combinations repeats throughout the
whole palette. Each Fader level appears twice in a row, with its two possible AMUX selector
choices.

All the while the upper five bitplanes (which came from the original Amiga 32-color animation) keep
the high order palette color values they had in the original Amiga animation. What’s been done by
BitPlay is to spread the original 32 colors related to the original 5 bitplanes into 256 colors by tacking
on the 1-bitplane AMUX animation and the 2 bitplane Fader animation and the result is a palette in
which there are patterns of 8 color variations which repeat essentially 32 times. Take a look at the
color table entries in the CrUD source file for GIRAFFE (shown below) to see this pattern as BitPlay
creates it for a real CrUD source file.

With that behind us (whew!) you could examine the frames of the GIRAFFE with a paint program

and you’d find that certain areas of the images use pixels of colors which are appropriate. One of the
disks accompanying this documentation (the GIRAFFE disk) actually contains the three original

Ss
animations used to construct the final GIRAFFE effect. You should examine all three of those
animations. First look at the Giraffe.Latch animation to see how the single-bitplane animation
reveals its role of broadly exposing either the Source2 video (to the left of the center of the Giraffe) or
the Source1 video (to the right of the Giraffe). Then look at the Giraffe. Alpha animation to see the 2-
bitplane animation follows the outline of the giraffe to let its edges smoothly fade between Source2
video and Encoder (the edges on the left side of the giraffe smoothly ramp over to the colored
giraffe’s Encoder signal) and the Encoder and Source? on the right side edges of the giraffe. Then
look at the Encoder animation to see the original 32-color giraffe animation itself. We'll run an
example of creating this effect later and let BitPlay merge them together and then you can see the end
result of the merge process and its effect on the original 32-color palette of the Giraffe.Encoder
images.

Creating FX - FX Elements and The FX Environment Tools
FX Elements - CrUDs, Amiga Graphics, and Effects (Crouton) Icons

Each effect is built from (a mimimum of) three components, a Crouton User Data (CrUD) file and an
Amiga Graphic file (either an ANIM or an ILBM IFF image), and an icon file for that effect. The
CrUD defines that nature of the effect and how the Toaster will handle the companion Amiga IFF
image or ANIM and run the effect. Amiga IFF graphics are already familiar. The icon file is simply
a 4-color Amiga IFF ILBM of 80 x 50 pixels. A special tool (call RunNot) is used (automatically)
during the effect-creation process to replace your 80x50 pixel IFF with an identical one which does
not have the typical IFF run-length compression. The final icon used for your effect will be an
uncompressed 80x50 IFF ILBM image.

A Closer Look at CrUD Source Files


```

#### CrUD Source Code Structure
```asm

3CrUD source file for GIRAFFE

Include "TAGS.I"

CrUD_START CrUD_ILBMFX,CruUD_4_0
3Encoder will show on the BMUX

TAG_Encoder TRUE
jThis does not play as a variable speed effect.

TAG _FCountMode 1
TAG_VariableFCount 0

;SlowFCount is 0 so no SLOW speed; MedFCount is 2 so each giraffe animation frame plays 2
;frames in MEDIUM speed; FastFCount is 1 so each giraffe frame plays 1 frame in FAST speed.

TAG_SlowFCount 0
TAG_MedFCount 2
TAG_FastFCount 1
TAG_ButtonELHlogic AFXT_Logic_LatchAencoderB

;’Latching’ (video source selection) on AMUX, keying (Fader control) controlled by DIB (same as
;4Level70ns, see tags.i).

TAG _LatchAM TRUE
TAG_KeyMode AFXT Key_DIB

sIf you want sound present on FAST speed play (its sample file should be in Speed! drawer of csrc
sduring effect creation by SingleMake, see below). These tags indicate that sound is present on FAST
sspeed but I’m informed there really isn’t a sound for GIRAFFE and that these tags simply are
signored because no sound file is available in csrc/Sound1 of the Envir drawer (see below).

TAG_AudioFastSamples AFXT_AudioFast
TAG_TurnAudioFilterOff TRUE

TABLE_PaletteColors

de.w 1
de.w 0
de.w 0

16
-W 240

al PACO_Mask_DIB+PACO_Mask_Latch
b.1 3,PACO_Mask_Nochange

deb.b 16,0

SS

;Every other color alternates the AMUX ’latch’ source selection and successive pairs of colors will
shave varying levels of Fader mixing between AMUX and Encoder present on BMUX. PACO_DIBO
3= 0, PACO_DIB1 = 1, PACO_DIB2 = 2, and PACO_DIB3 = 3 (the four levels of DIB-controlled
sFader level). In one of the earlier CrUD examples we saw these DIB levels explicitly declared as
snumerical values (#$00000000, #$00000001, #$00000002, and #$00000003) while here they are
sdeclared using value names from tags.i.

* -—-------- Color Table with 240 entries ------ —

de.10+PACO_DIBO+PACO_CurrentOverLay
de.1 0+PACO_DIBO+PACO_CurrentMain
de.10+PACO_DIB1+PACO_CurrentOverLay
de.10+PACO_DIB1+PACO_CurrentMain
dc.10+PACO_DIB2+PACO_CurrentOverLay
de.10+PACO_DIB2+PACO_CurrentMain
dc.10+PACO_DIB3+PACO_CurrentOverLay
de.10+PACO_DIB3+PACO_CurrentMain

|
|

(the pattern of 8 values above repeats 28 times here)

dc.10+PACO_DIBO+PACO_CurrentOverLay

dc.10+PACO_DIBO+PACO_CurrentMain
dc.10+PACO_DIB1+PACO_CurrentOverLay
dc.10+PACO_DIB1+PACO_CurrentMain

dc.10+PACO_DIB2+PACO_CurrentOverLay

de.10+PACO_DIB2+PACO_CurrentMain

dc.10+PACO_DIB3+PACO_CurrentOverLay

de.1 0+PACO_DIB3+PACO_CurrentMain

TABLE_END
CrUD_END

LR CCR SIC ACC HEI AC A IIE AE FCA FF Hf RE A FR FE 2 A I EA FR AC AE HE A AE af ACHE AE

17
The FX Creation Environment and Tools

An automated processing system for building effects from the three component parts is part of your
developer package. It is called FXTools and comprises a directory on an Amiga storage volume.
FXTools includes a number of programs (tools) and subdirectories.

The tools in FXTools are:

BitPlay - a program which merges 3 anim files into one and creates an appropriate CrUD file for
inclusion in the final effect. BitPlay is called automatically by the animated effects ’make’
script. The CrUD file created by BitPlay is actually an assembly language source file for
the CrUD chunk of an effect file.

AnimTool - a program which can process an existing anim file and convert it to a specialized
form (a Smart Anim) which plays at maximum speed under the Toaster’s FX anim playing
system. Smart Anim files may be mixtures of different types of Amiga anim compression.
AnimTool analyzes the anim file it is processing and determines what form of frame-to-
frame compression is best for each successive frame. The result is a Smart Anim which
partly use AnimS, Anim7, or Anim8 compression between frames - or even no compression
at ali between certain frames. AnimTool also analyzes your original animation to detect
whether it can play smoothly on a Toaster effect. For most of your original animations it is
wise to generate them as 384x241 with 32 colors. Many animations of this type can simply
be prepared as Anim7 or Anim8 files and won’t require conversion to Smart Anim format.
You can test the resulting Toaster animated effects yourself and determine whether they’d
benefit from AnimTool processing. AnimTool is not called automatically by the batch
AmigaDos script files that build the effect from its components. AnimTool is supplied for
you to use as needed.

AnimSplicer - a animation construction and deconstruction utility. AnimSplicer, like
AnimTool, is not called automatically by the effects make’ scripts. It is provided to let
you merge animations you’ve built in sections into a single Anim file.

The subdirectory structure of FXTools looks like this:

Make4.0 - drawer
csrc - drawer containing source portions of your effect

Anim - source ILBM or ANIM files (SingleMake looks here)
Date - drawer used for temporary date storage and compares

CrUD - drawer containing CrUD files corresponding to the

contents of the Anim drawer’s graphics files (SingleMake
looks here for the CrUD source file)

Date - drawer used for temporary date storage and compares
Binary - drawer for CrUD object file binary data

Icon - drawer containing your crouton icon IFF images
Has icons for the example effects creations we’ll do plus a
sample of a color icon (VTLogo), and the ’GenericIcon’.
Date - drawer used for temporary date storage and compares

Sound! - drawer with IFF 8SVX sampled sound for FAST speed
Camera Iris sound effect file
Date - drawer used for temporary date storage and compares

Sound2 - drawer with IFF 8SVX sampled sound for MEDIUM speed
Date - drawer used for temporary date storage and compares

Sound3 - drawer with IFF 8SVX sampled sound for SLOW speed
Date - drawer used for temporary date storage and compares

18
Toaster - drawer
Effects - drawer where final effect and icon are deposited by the

```

### Blinds 3 Expand (Algorithm Effect)
- **Source:** Developers Handbook, p. ~70
- **Concept:** A mathematical/algorithmic effect that divides the screen into sections.

#### CrUD Source Code Structure
```asm

The following is a complete printout of the CrUD source file for the Blinds 3 Expand Algo effect,
with a little added commentary. If necessary, please review the NewTek Video Toaster FX Theory
document (11/28/95) to recount the basic structure of a CrUD file. The CrUD file for an Algo effect
of this type (blinds) consists of only a few tags (which are defined in the tags.i file included on the
first line, and which you can find in the AlgoTools/envir/inc drawer). The tags which you should
note immediately below are the tag macros CrUD_START and CrUD_AlgoFX which define this
type of effect CrUD source as an Algo effect (the definitions for these tag macros are in tags.i). The
other interesting tag is the last one, TABLE_Equations which form the real essence of an Algo effect
CrUD - they point to the collection of constants at the end of the CrUD file itself which are the
parameters the Toaster’s internal Algorithmic Effect generator interpret to manipulate the DVE
Address Generator. The last constant in the TABLE Equations set is the number, 3. Note the
comment here indicates the this number denotes the number of rectangles (blinds) for this effect.

include "tags.i"
CrUD_START CrUD_AlgoFX,CrUD_4_0,CrUD_BWIcon

TAG_FCountMode 1

TAG VariableFCount 0

TAG_SlowFCount 60

TAG_MedFCount 45

TAG _FastFCount 30

TAG_AlgoFXtype ALGT_StdDigitalFX
TAG_ButtonELHlogic | AFXT_Logic_TDEon

TABLE_Equations

10$ del 20$-10$ salways points to Time Variables
dc.1 DEF_REVERSE smodes
208 dew 3 jnum rectangles horizontally

Guess what happens if we change the 3 to a 2, above, with no other changes to this CrUD source
file...

The following comments can guide you when you explore the meanings of some of the tag and
constant defnitions in tags.i, efib i, rect.i, crouton.i, etc. Note the ’03=lIinear ...’ comment which
informs us that the four numbers following a ’LINEAR’ tag constant later in this source file will
indicate the distance and speed variables which move the rectangles at a constant speed. The
*04=accelerated ...’ comment informs us similarly about the meanings of the five numbers which
accompany a ’ACCEL’ tag. This effect does indeed use LINEAR tags to specify motion of the three
rectangles which make up this effect (see below).

500 =end of table
301 = ignore
502 = constant WORDvalue

sall 03,04,05 parameters are binary reals (LONGS)
303 = linear initDistance, speed, minDistance, maxDistance
; mind <= sp*t+id <= maxd

304=accelerated _initVelocity, accel, minSpeed, maxSpeed, initDistance
3 (minsp <= ac*ttiv <= maxsp)*t + id

4
Harmonic motions are bouncing motions in a sinusoidal manner. You'll see them used in some of the
effects which move video onto or off the screen in a jiggling manner.

305 = harmonic initFreq, deltaFreq, minFreq, maxFreq, initPhase,
; iAmp, deltaAmp, minAmp, maxAmp
; (minam <= da*t+ia <= maxam)*t * SIN[(minfr <= df*t+if <= maxfr)*t + ip]t+os

Now we find a fixed-structure table of values which designate the horizontal (X) behavior (scaling) of
each of the three rectangles. Note that this type of effect can have only a single Y behavior which
governs all of the rectangles the same way, but X behavior can be manipulated differently for each
rectangle. That’s handy, as we really do wish to (at least) place each of the rectangles at different
horizontal positions. The ET_DVEIX tells the Toaster’s AlgoFX software that this is the start of the
position and motion table of values for rectangle #1. Later you’ll find ET_DVE2X and ET_DVE3X
which denote similar table start declarations for the other two rectangles in this effect. Each of the
rectangle position and motion tables is in a fixed form and the comments you’ll find tell you the
meaning of each item. TVT_CONST means the following value is a constant for the whole effect.
TVT_LINEAR denotes a set of four numbers follows which dictate a linear (smooth) motion, etc.
SXMIN means Source X Minimum, the leftmost position from which source video will arise (0).
SXSIZE is the Source X Size in quads’, namely a full screen width (185 quads). The values for
these and most of the other constants (DXMIN = Destination X Minimum, SXMAX, etc.) are found
in croutons.i.

;XSCALE 1
dce.w ET_DVE1X1

sborderUpper
dc.w TVT_CONST
de.w $0000

sborderLower
de.w TVT_CONST
de.w $0000

We want the center position of the leftmost rectangle’s source video, which will occupy one third of
the screen, to originate 1/6 of the way from the left boundary of the source video.

sposition

de.w TVT_CONST

de.w SXSIZE/6
The minimum width of the source video is 2 quads.
jsrcMin

de.w TVT_CONST

de.w SXMIN

The maximum width of the source video for this rectangle is 1/3 of the source’s total width.
ssrcMax

dc.w TVT_CONST

dc.w SXMIN+SXSIZE/3

The center of the region of source video from which this rectangle is drawn is 1/6 of the way from the
left of the source video boundary.

5S
jsrcAxis
de.w TVT_CONST
de.w SXMIN+SXSIZE/6

You can see that the destination positions and axes are arranged to correspond to the positions at
which we want the source video to be ’painted’ into the destination frame.

jdestMin
dce.w TVT_CONST
dce.w DXMIN

jdestMax
de.w TVT_CONST
de.w DKMAX

sdestAxis
de.w TVT_CONST
dc.w DXAXISMIN

The size of the rectangle will increase from thin to thick (see comments earlier in this file which
summarize the meaning of the four numbers which follow this tag).

seffectSize

```

---
*End of Document*
