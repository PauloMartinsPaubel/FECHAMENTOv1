@echo off
rem Envia uma vez os turnos que mudaram. Usado pelo Agendador de Tarefas e para enviar na hora.
cd /d "%~dp0"
node agente.mjs --uma-vez
