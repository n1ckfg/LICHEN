## INTER GRAPHICS 83

## Tutorial Sessions A 5

<!-- image -->

This Page Intentionally Left Blank

## DATAMAX UV-1 Zgrass GRAPHICS SYSTEM

## Zgrass TRANS PACKAGE DOCUMENTATION &amp; GLOSSARY

Software Tools for Three Dimensional Vector Images

January 12, 1983

Design, Inc. 531 South Plymouth Court, Suite chical Rights Reserved

## COPYRIGHT NOTICE

Copyright 1983 by Real Time Design, Inc. reserved. No part of this publication may be reproduced, transmitted, transcribed, system, translated into any human or computer language, in any form any means, electronic, mechanical, magnetic, optical, chemical, manual. or otherwise, written permission Real Time Design, Inc., 531 South Plymouth Court, Suite 102, Chicago, IL 60605 USA.

## DISCLAIMER

Real Time Design, Inc. makes no representations or warranties with respect to the contents hereof and disclaims any implied warranties of merchantibility or fitness for any particular purpose. Further, Real Time Design, Inc. reserves the right to revise this publication and to make changes from time to time in the content hereof without obligation of Real Time Design, Inc. to notify any person or organization of such revision or changes.

Zgrass TRANS PACKAGE Documentation

## GETTING STARTED WITH TRANS

Before you start your first session, refer to the lgrass Utility Disk User's Guide for instructions on how to make a copy of the TRANS disk. After you've made a copy of the disk, insert the copy into drive 0 of your disk drive and type:

## DS 0; DG GETRANS; GETRANS

help is available with GETDEMO macro the GETHELP and COMMANDS provides a menu of sample macros which DEMOnstrate system features. You can examine these examples of TRANS command séquences by printing the DEMO macros:

## DG DOPYR; DOPYR; PR DOPYR

A categorized summary and Glossary of the TRANS commands are included in this guide.

## INTRODUCTION

The Zgrass TRANS PACKAGE, generally referred to as TRANS for short, is a set of macros and swap modules designed for modelling three-dimensional vector (wire-frame) objects on the Datamax UV-1 Zgrass Graphics System. It is targeted for people who are familiar with basic programming concepts of the lgrass language, as as three-dimensional coordinates, and geometric transformations.

The basic approach to TRANS involves three steps:

- object creation: objects are defined by storing the and COLORMODE in 2-dimensional The macro GETOBJ offers a menu of macros which to define wire-frame objects.
- Transformation definition: geometric transformations are defined through the use of commands such as HoMe, MOVE, ROT, SCALE3D, and SHEAR. Successive operations multiplied together and saved in a transformation array.
- Image display: images are displayed by (optionally) applying array to the coordinates the vectors are drawn on the screen with the commands TDISP and ODISP. Simple perspective can be used clarify the three-dimensional nature of the images with PDISP command.

1/12/83

Page 3

## 1/12/83

Page 4

animations are easily created with incremental transformations displayed on different screens. These are played back by 'flipping' through the screens in sequence with the FlIp command. The DEMO macros illustrate this technique.

## USING THE TRANS PACKAGE

Although some menus are provided to get you started, the TRANS PACKAGE is basically a command driven system. In TRANS, only one currently active, or OPEN, transformation display commands apply to the current OPENed object. Several objects can be GROUPed together in a hierarchical structure. GROUPs can be OPENed and then transformed same commands as simple objects.

TRANS commands can be utilized in two ways. The first way, mode, is by entering separately on the terminal keyboard. The second way is to create a macro with the desired sequence of commands. See the following examples:

```
· EXAMPLE command mode SETPRISM ETTA, 100,100,100; ·create a prism called ETTA OPEN ETTA;. make ETTA the current object ROT Y,40;. rotate 40 degrees around Y axis ROT X,12;. rotate 12 degrees around X axis TDISP;. display HOME:. reset transformations MOVE 90,20,0;. move to the right & up SHOWALL;. list the coordinates on the terminal EXAMPLE2=[. macro mode DGET SETCUBE SETCUBE CHRISTINE, 100,100,100; create CHRISTINE;. make CHRISTINE the current object SCALE3D 2,1,1;, scale PDISP 200:. display with perspective SCALE3D ,5,.5,.5;. scale all directions PDISP 200
```

```
EXAMPLE2
```

Zgrass TRANS PACKAGE Documentation

## PROGRAMMING NOTES

irray types and data structures

The primary data structures of the TRANS PACKAGE are vector lists, transformation matrices, and groups:

- Vector lists are Nx4 structures which can be stored in either INTEGER or FLOATING POINT arrays. The primary advantage of INTEGER arrays is that they require approximately one half of the memory that FLOATING POINT arrays require for the same number of points. However, INTEGER arrays may introduce more roundoff error than FLOATING POINT arrays. This will be a problem particularly if the REFORM command is used, since INTEGER arrays will cause the new coordinate values to be truncated to integers. In general, INTEGER arrays are sufficient for uses where screen coordinate system can also be used as data coordinates.
- Transformation matrices are 4x4 arrays. They should always be declared as FLOATING POINT since compounding of transformations generally results in floating point values.
- Groups used to create hierarchical (tree) structures. are defined dimensional arrays. Each element of a group is a NAME, either the name of a vector list or the name of another TRANS Glossary entries for the SGET and SPUT swap commands to see how to store and retrieve string arrays from

A TRANS structure consists of two parts - a data array (vector list group) and companion transformation matrix. The characters T$ are prefixed to the data array name to derive the name for the matrix. See the TRANS Glossary entry on NAMES for further details.

1/12/83

Page 5

Zgrass TRANS PACKAGE Documentation

## Space considerations

separate vector lists or dealing with objects with many vectors you that you run out of space in memory. The following are a few tips on how reduce memory requirements.

You can delete some of the TRANS PACKAGE macros which you do not need without interferring with performance of other macros. These can be retrieved from disk with the DGET command if wanted later. The first likely candidates are the GETOBJ, GETDEMO, and GETHELP macros. These are mainly needed for reference when learning the system and are not used by any other macros. Ihe COMMANDS macro can also be deleted without harm, but it is a useful reference even for an not using experienced TRANS user. If you are groups, the GROUP, GHOME and GDISP macros can be eliminated. The FLIP macro is only used for screen animations, ND.B is a quick alternative (it is a resident system command).

If your normal use of the TRANS PACKAGE suffers from space problems, the GETRANS easily be cistomized so unwanted macros are not loaded into memory. It is advised that you comment out unwanted lines instead of deleting them. This can be done editing GETRANS and making the lines which DGET the unwanted macros into comments inserting a . (period) as the first character of the line. You may wich to save the updated GETRANS on your TRANS disk.

## The coordinate system

TRANS uSeS a standard X,y,z coordinate system with 0,0,0 being at the center of the screen. Positive X values are to the right and positive Y values are up. The TRANS PACKAGE uses a right-handed coordinate system with the positivel axis coming toward the viewer. Positive rotations about an axis are counterclockwise. You can use the following list as a reference for rotational direction:

- A 90 degree rotation about the X axis moves +Y to +z.
- degree rotation about the Y axis moves +Z to +X.
- A 90 degree rotation about the Z axis moves +X to +y.

Single point perspective views are generated from a vantage point somewhere on the z axis. The location on the axis thought of as "pixels away from the screen".

1/12/83

Page 6

## Creating objects

The GETOBJ menu provides a list of macros which create TRANS objects. Additional macros to create vector lists can easily be written. Any of the object creation macros, such as SETCUBE, will a good example of the type of commands needed. The only must be done is ARRDATA command to keep track of the number of vectors in the list. For example:

```
.EXAMPLE3 object creation ARRAY.I TRI, 9,4; space for 9 points OPEN TRI SETPOINT 0,50, -20,0,4;. SETPOINT uses OPEN array SETPOINT 1,0,50,0,1 SETPOINT 2, -50, -20,0,2 SETPOINT 3.50, -20,0,3 ARRDATA TRI, 3,4;. number of points used MOVE - 60,0,0; move to left TDISP;. display SETPOINT 4,0,50,0,4 SETPOINT 5,0, -80,0,3 ARRDATA TRI,3,6;. number MOVE 120, 0,0; move to right TDISP points used
```

1/12/83

Page 7

## Summary of TRANS Commands

## * General *

```
OPEN arrayname COPY from, to PARICOPY from, to, start, stop SHOWALL REFORM GROUP groupname,count, name,name,... MERGE finalname, type.count, name, name....
```

## * Transformations *

```
HOME MOVE x,y,z ROT axis, angle SCALED X.y, z SHEAR laxis, 2axis, value GHOME
```

## * Help Menus *

```
GETHELP;. help GETOBJ;. object creation GETDEMO;. demo
```

macros

## * Display (optional argument) *

ODISP [colormode] PDISP distancel,colormode] TDISP [colormode] GDISP gname

## * Animation

FLIP lowscreen,highscreen,delay

Zgrass TRANS PACKAGE Glossary

1/12/83

Page 9

ARRCAT DESTARRAY, ARRAY1, LOWER1, UPPER1,..., ARRAYn, LOWERn, UPPERn Esoteric Swap Command takes the values ARRAYi(LOWERi) thru ARRAYi(UPPERi), for 1 to concatenates the m together. and the new array DESTARRAY. The arrays may be of any type (FLOAT, INTEGER, STRING), as long as are of the same type. DESTARRAY is always created as a one dimensional array.

ARRDATA ANAME, 1

ARRDATA ANAME, 3, NUMBER

ARRDATA ANAME, 2

ARRDATA ANAME, 4

ARRDATA ANAME, 6, NUMBER

ARRDATA ANAME, 5

Esoteric Swap Command stores and retrieves information in the grass system header of array ANAME. The second argument is a flag indicating which information to process. The third argument (when needed) is used to update the header. One important application of counter. stored in the header. WARNING!! ARRDATA should be used with one or two dimensional arrays only. (We call the first dimension rows and the second columns.) ARRDATA acts according to the following table:

## Flag Action

- 1 RETURNs the number of rows
- 2 RETURNs the current value of the counter
- 3 NUMBER in the counter
- Ц RETURNsa code for the array element type (5= INTEGER, 7=FLOATING POINT, 9=STRING)
- 5 RETURNs the number of columns
- 6 reconfigures array as a two dimensional array with NUMBER columns

## Example:

TEST= [ARRAY PETE, 4,3 ARRDATA PETE, 3,0;. set counter to 0 PR ARRDATA (PETE PR ARRDATA PETE 21. AS DAe COunter, row coLumn' PR ARRDATA (PETE, 4), 'is the type of element, ARRDATA PETE, 3,2;. set counter to 2 ARRDATA PETE,6,4;. make PETE a 3x4 array PR ARRDATA(PETE, 1),ARRDATA (PETE,5 ),'row column' PR ARRDATA (PETE, 2), 'is the counter' ] TEST

## Zgrass TRANS PACKAGE Glossary

COMDID

COMG3D1

COMG3D2

COMO3D

COMT3D

Filename these are a series of files which are used by the GETHELP macro to provide online help.

## COMMANDS

Trans · Command will show a brief index of TRANS commands.

## COPY SOURCE, DESTINATION

copies array SOURCE to array DESTINATION. COPY can be

Trans Command

## DEBUG

Idiosyncracy

í DEBUG:1 before runnin will be GETRANS, none of the macros modifying or examining the TRANS

Idiosyncracy macros provided on the TRANS disk to demonstrate the system. Any of the following can be printed by the user as illustrations of command sequences DOCUBE, DOGRID,

DOGROUP, DOPRISM, DOPYR, DOQUBE.

## DOCUBE

Trans Command changing perspective distance with PDISP image views.

SETCUBE DEMOnstration macro. Also demonstrates effect of for successive

## DOGRID

Trans Command

SETGRID and SHEAR DEMOnstration

## DOGROUP

Trans Command

DEMOnstrates the use of GRoUps displaying hierarchical structures. for modelling and

## DOPRISM

SETPRISM DEMOnstration macro. Also uses SCALE3D. and the color override optional argument of plIsP.

Trans Command

## DOPYR

Trans Command transformation arrays as well as

ROT and SETPYRAMID DEMOnstration macro.

Zgrass TRANS PACKAGE Glossary

## DORUBE

7 rotating cubes DEMOnstration macro. This macro and REFORM to construct single vector list before displaying it.

DODISP ARRAY

DODISP ARRAY, COLORMODE

DODISP ARRAY, START · STOP

## Trans Swap

DODISP ARRAY, START, STOP, COLORMODE

Displays vectors using the elements of a NX4 ARRAY as X.Y.Z, and COLORMODE values. The vectors are displayed with an orthogonal projection. If COLORMODE is given, it overrides all stored colormodes except 4. The START and STOP arguments are used to draw subsection of an ARRAY.

DDISP ARRAY, TARRAY, DISTANCE

DPDISP ARRAY, TARRAY, DISTANCE, COLORMODE

DPDISP ARRAY, TARRAY, DISTANCE, START, STOP

DPDISP ARRAY, TARRAY, DISTANCE, START, STOP, COLORMODE

## Trans Swap

displays vector using the elements of an NX4 ARRAY X,Y,Z, and COLORMODE values. Each point is TARRAY, a 4x4 transformation array, before displayed. A perspective view generated DISTANCE "pixels from the screen". If COLORMODE is given, stored colormodes except 4 are overridden. START and STOP arguments are used to draw a subsection of an array. Note: weird effects may occur if some ? coordinates are larger than DISTANCE.

DTDISP ARRAY, TARRAY

DIDISP ARRAY, TARRAY, COLORMODE

DIDISP ARRAY, TARRAY, START, STOP, COLORMODE

DIDISP ARRAY, TARRAY, START, STOP

## Trans Swap

displays vectors using the elements of an Nx4 ARRAY as and COLORMODE values. Each point is multiplied TARRAY, 4x4 transformation array, before being displayed. If COLORMODE is given, stored colormodes except 4 are overridden. The START and STOP arguments are used to draw a subsection of an array.

## EDARRAY

## Trans Command

converts the OPENed array into the string $Edarray and invokes EDIT so one can insert, delete, etc. Use RESTORE to convert $Edarray back into an array. This command is not loaded by GETRANS.

1/12/83

Page 11

Zgrass TRANS PACKAGE Glossary

## FLIP LOWSCREEN, HISCREEN, DELAY

Trans Command multi-screen animation by changing $TV from LOWSCREEN to HISCREEN and then back to LOWSCREEN. DELAY to control the rate of change. Each

DEMOnstration macro uses FLIP.

## GDISP GNAME

Trans command displays GROUP GNAME by displaying each member in turn. To display members which are themselves · GROUPS, GDISP calls itself recursively. A global array, $Ctm, is used to pass compounded transformations to the successive members of a GROUP.

## GETDEMO

Irans Command provides a menu listing the TRANS PACKAGE DEMOnstration macros on the terminal. It gets the chosen disk and runs it.

## GETHELP

Trans Command provides a menu listing the TRANS PACKAGE help options. The selected option is read from disk and displayed on the terminal.

## GETOBJ

provides a menu of object generation selected macro(s) are read from disk. macros. The

Trans Command

## GETRANS

Trans Command loads TRANS PACKAGE from disk.

## GHOME

Trans command the global current transformation matrix, $Ctm, to the identity matrix. This matrix is used by GDISP when displaying groups.

GROUP GROUPNAME, COUNT, NAME , NAME, NAME,...

## Trans command

creates called GNAME with COUNT members; NAME, NAME, · The members can be vector lists or other GROUPS. GROUPs are used for dealing with hierarchical collections of objects and allow compounding multiple of transformations. Use GDISP to display GROUPs. See the macro DOGROUP for an example which uses groups.

1/12/83

Page 12

## Zgrass TRANS PACKAGE Glossary

HOME

Trans Command

Filename

1/12/83

Page 13

sets the OPENed identity. object's transformation matrix to introduction to TRANS. Can be accessed with GETHELP.

MERGE FINALNAME, TYPE, COUNI, NAME, NAME, NAME...

merges COUNT number of objects into a new array called FINALNAME. IF TYPE is 1, each object's transformations are applied to its coordinates when merging. If TYPE is

Trans Command

O, the coordinates are merged unchanged.

MOVE X.Y,Z

Trans Command moves the OPENed object X,Y,z pixels in thex, Y,and z directions by multiplying proper matrix into the

transformation array.

MXMUL ARRAY, ARRAY, DEST

multiplies a MxN array with a NxP array using the rules for matrix multiplication. The resultant MxP array

Swap Command is stored as DESTARRAY.

## NAMES

Idiosyncrasy

TRANS PACKAGE names and global variables. variables have names which begin with the $ character.

Global

These 4 variables are #Array are worne ring kong given values by the OPEN command: storing X.Y,z and COLORMODE or string array storing GROUP member

$Matrix FLOATING POINT array storing 4x4 geometric transformation matrix names

$Araynam character string with name for OPENed object SMtrxnam character string with name for opENed matrix name indicates that the array

The prefix T$ in an array is a 4x4 transformation array (i.e., I$PIX is the matrix for PIX). The OPEN command creates an array with such name if one does not exist when an object is OPENed.

$Ct m command global transformation matrix used by the GDISP

string with X,Y.,Z.COLORMODE values on each This string is created turns Edarray into a

$Edarray is a line, separated commas but no spaces. created by the EDARRAY command; it can also be with EDIT. The RESTORE command coordinate array.

Zgrass TRANS PACKAGE Glossary

ODISP

Command

ODISP COLORMODE

displays the OPENed object without transformations. If COLORMODE is specified, it stored in the vector list. overrides the COLORMODES

## OPEN ARRAYNAME

Command display, and other commands transformation matrix object if one doesn't exist. See NAMES for more info.

makes ARRAYNAME the object to which transformation, will apply. OPEN creates (named 'T$'&amp;ARRAYNAME) for the

## PARICOPY SOURCE, DESTINATION, STARI, SIOP

Trans Command copies row START through row STOP from array SOURCE to

DESTINATION.

PDISP DISTANCE

PDISP DISTANCE, COLORMODE

Trans Command displays the OPENed object with its transformations and a perspective projection viewed DISTANCE "pixels from the screen". A right-handed coordinate system is used, with +z coming out of the screen. If COLORMODE is specified, it overrides the COLORMODEs stored in the vector list.

## REFORM

Trans Command nakes object coordinates by multiplying the transformation matrix into the vector list of the OPEN object.

## RESTORE NAME

Trans Command converts string $Edarray into an array called NAME with proper length and OPENS NAME. Commonly used after EDARRAY, but can be used independently, provided $Edarray has the correct format. $Edarray values for X,Y,z, and COLORMODE on each line, separated by commas without spaces, for RESTORE to work properly. RESTORE is not gotten from the disk by GETRANS. RESTORE

uses the swap SFIND.

## ROT AXIS, ANGLE

## Trans Command

rotates the OPENed object ANGLE degrees about the specified AXIS by multiplying the proper rotation matrix into the transformation array. AXIS is X,Y, or Z.

1/12/83

Page 14

## Zgrass TRANS PACKAGE Glossary

## SCALE3D X,y,z

Trans Command the OPENed object by factors of x,y,z along the X, and Z axes. SCALE3D multiplies the proper scale matrix into the transformation array.

## SEICUBE NAME, WIDTH, HEIGHT, DEPTH

Trans Command creates an INTEGER array of cube coordinates with WIDTH, HEIGHT, DEPTH. The array, called NAME, is OPENed displayed by this command. Can be accessed with the GETOBJ menu.

## SEIGRID NAME, XSIZE, YSIZE, INCREMENT, COLORMODE

## Trans Command

creates a plane grid of dimensions XSIZE by YSIZE. Vectors are given COLORMODE and spaced INCREMENT pixels apart. Can be accessed with the GETOBJ menu.

## SETKEY NAME, SIZE

Trans Command used to enter SIZE coordinates into array NAME with the terminal keyboard. Included in the GETOBJ menu.

## SETPOINT INDEX, X,Y,Z, COLORMODE

## Trans Command

assigns X,Y,z, and COLORMODE values to row INDEX of the OPENed array. This command is useful when defining objects.

## SETPRISM NAME, BASE, HEIGHT, DEPTH

Trans Command creates an INTEGER array with the coordinates rectangular prism of base BASE, height HEIGHT, and depth DEPTH. The array (NAME) is OPENed, but is not displayed. Can be accessed with the GETOBJ menu.

## SEIPYRAMID NAME, BASE, HEIGHT

## Trans Command

INTEGER with the coordinates square pyramid of base BASE and height HEIGHT. Can accessed with the GETOBJ menu.

## SETABLET NAME, SIZE

## Trans Command

array NAME with space for SIZE coordinates. Vectors are entered into the array by drawing with the tablet. All l coordinates are stored as o. accessed the GETOBJ menu.

1/12/83

Page 15

## Zgrass TRANS PACKAGE Glossary

SFIND STRING, START, CHAR

Esoteric Swap Command location of CHAR in the string STRING. Searching begins at location START in the string. Use to search the entire string. If CHAR is not SFIND returns.-:. Note that CHAR must be given as an INTEGER, string. table in the GLOSSARY for character codes. Example:

TERRY = [ABCDABC]

PR SFIND (TERRY, 0., 65) , SFIND (TERRY, 1, 65) , ASCII (65)

will print

04 A

## SGET NAME

copies the string array from the current screen back into user memory as a regular string array. This command is used to restore a string array which has been stored on disk using the SPUT and DPUT.S commands. See SPUT for an example using this command.

Esoteric Swap Command

## SHEAR TAXIS, ZAXIS, VALUE

shears the OPENed object on lAXIS along LAXIS by VALUE. 1AXIS and ZAXIS must be either X, Y, or z.

Trans Command

## SHOWALL

prints the transformation matrix and the vector list of the OPENed object on the terminal. If a GROUP iS OPEN, the members are listed.

Command

1/12/83

Page 16

## Zgrass TRANS PACKAGE Glossary

1/12/83

Page 17

## SPUT (STRINGARRAY)

Esoteric Function the STRINGARRAY and stores it in the current screen. SPUT returns how many bytes of screen to store the array. Note that this affects the image on the screen that $MW is set to. Example:

ARRAY.STR PATTI, 3

PATTI (0) ="BANANA"

PATTI (2) = "MANGO"

DPUT.S SPUI (PATTI), SPATTI, [STRING ARRAY PATTI]

the string array PATTI into screen memory and store it on disk using the name SPATTI. The disk name used in the DPUT command must be different than the string array which is currently in user memory. To get a saved string array off of a disk use the DGET and SGET commands as in:

DGET SPATTI SGET KANGA PR KANGA(O) , KANGA(2)

BANANA MANGO

will print

## SYSTEST

Trans Command this command tests the TRANS PACKAGE by running each of the DEMO macros consecutively.

Idiosyncracy used to identify transformation matrices. For example, T$PIX is the matrix for the array PIX. See NAMES for further information.

IDISP

TDISP COLORMODE

Irans Command displays the OpENed object with itsit averrides the applied. If COLORMODE is specified COLORMODEs stored in the vector list.

TRANO

TRANZ

TRANT

Filename disk files with the macro definitions of COPY, MOVE, HOMPOINT. SHE BP ESHOWALET PARICOPY, REFORM, ROT, SCALE3D, TDISP, PDISP, ODISP, They used by GETRANS when initializing the system.

## UNITY ARRAY

Trans Swap sets a 4x4 ARRAY to the identity matrix; l.e., l's on the main diagonal and o's elsewhere.

Copyright © 1983

World Computer Graphics Association, Inc.

2033 M Street N.W. Suite 399 Washington, D.C. 20036, U.S.A.

Printed by: SEINO PRINTED Co., Ltd.

Tokyo, Japan