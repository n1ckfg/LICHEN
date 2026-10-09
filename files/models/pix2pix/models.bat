@echo off

cd %~dp0

powershell -Command "Invoke-WebRequest https://fox-gieg.com/patches/github/n1ckfg/LICHEN/files/models/pix2pix/pix2pix_models.zip -OutFile pix2pix_models.zip"
powershell Expand-Archive pix2pix_models.zip -DestinationPath .
del pix2pix_models.zip

@pause