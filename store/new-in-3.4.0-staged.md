# 3.4.0 release notes staged for Step 8

Use these blocks after Steps 4 and 5 merge and the manifest becomes 3.4.0. Update each listing's version heading and replace its current 3.3.8 block with the block below. Drop the superseded 3.3.8 block in all six listings: retaining it as FROM makes the French Chrome description exceed 16,000 characters. Keep the manifest and current release blocks unchanged until then. Update the tests that pin 3.3.8 during Step 8.

The access bullet depends on Step 4 for Download all, Gradescope, Look media and mod network hosts. Re-check it against the merged code. The Firefox package also needs Step 5's removal of declarativeContent.

Paste each block into the named listing. Keep both browser labels, including the French space before the colon. scripts/store-release.mjs calls readListings in scripts/store-listings.mjs: Firefox's notes and description exclude Chrome/Safari bullets; Apple's What's New excludes Chrome/Firefox bullets. Chrome's paste kit keeps the full detailed description, including both labelled bullets. The two unlabelled bullets below are true on Safari too. Check the generated text for all six languages before submission. Paste the permission justifications directly from store/listing.md: writeChromeKit emits only the summary and detailed description. Mirror the changed guides at release; do not publish them from this copy-review branch.

## store/listing.md

NEW IN 3.4.0

• Chrome: Glaze asks at install for the hosted LMS domains instructure.com, blackboard.com and moodlecloud.com, plus its gallery and share relay. Add your school's site from Glaze's toolbar button, the install tab or Settings › Sites. Download all, Gradescope, Look media and mod network hosts request missing access when needed.
• Firefox: Glaze asks at install for the hosted LMS domains instructure.com, blackboard.com and moodlecloud.com, plus its gallery and share relay. Add your school's site from Glaze's toolbar button, the install tab or Settings › Sites. Download all, Gradescope, Look media and mod network hosts request missing access when needed.
• Moodle on moodlecloud.com works from install.
• Course tabs show a sketch of the course while it loads, instead of a picture of the page.

## store/listing-de.md

NEU IN 3.4.0

• Chrome: Glaze fordert bei der Installation Zugriff auf die LMS-Domains instructure.com, blackboard.com und moodlecloud.com sowie auf seine Galerie und seinen Freigabeserver an. Füge die Website deiner Schule über Glazes Schaltfläche in der Symbolleiste, den Tab bei der Installation oder Einstellungen › Websites hinzu. Alle herunterladen, Gradescope, Look-Medien und Netzwerkzugriffe von Mods fordern fehlende Zugriffsrechte bei Bedarf an.
• Firefox: Glaze fordert bei der Installation Zugriff auf die LMS-Domains instructure.com, blackboard.com und moodlecloud.com sowie auf seine Galerie und seinen Freigabeserver an. Füge die Website deiner Schule über Glazes Schaltfläche in der Symbolleiste, den Tab bei der Installation oder Einstellungen › Websites hinzu. Alle herunterladen, Gradescope, Look-Medien und Netzwerkzugriffe von Mods fordern fehlende Zugriffsrechte bei Bedarf an.
• Moodle auf moodlecloud.com funktioniert ab der Installation.
• Kurs-Tabs zeigen beim Laden eine Skizze des Kurses statt eines Bildes der Seite.

## store/listing-es.md

NOVEDADES DE 3.4.0

• Chrome: Al instalarse, Glaze pide acceso a los dominios de las plataformas instructure.com, blackboard.com y moodlecloud.com, además de su galería y servidor de retransmisión. Añade el sitio de tu centro desde el botón de Glaze en la barra de herramientas, la pestaña de instalación o Ajustes › Sitios. Descargar todo, Gradescope, los archivos multimedia de los Looks y las conexiones de red de los mods piden los permisos que falten cuando los necesitan.
• Firefox: Al instalarse, Glaze pide acceso a los dominios de las plataformas instructure.com, blackboard.com y moodlecloud.com, además de su galería y servidor de retransmisión. Añade el sitio de tu centro desde el botón de Glaze en la barra de herramientas, la pestaña de instalación o Ajustes › Sitios. Descargar todo, Gradescope, los archivos multimedia de los Looks y las conexiones de red de los mods piden los permisos que falten cuando los necesitan.
• Moodle en moodlecloud.com funciona desde la instalación.
• Las pestañas de cursos muestran un boceto del curso mientras carga, en lugar de una imagen de la página.

## store/listing-fr.md

NOUVEAUTÉS DE LA VERSION 3.4.0

• Chrome : À l’installation, Glaze demande l’accès aux domaines des plateformes instructure.com, blackboard.com et moodlecloud.com, ainsi qu’à sa galerie et à son relais de partage. Ajoutez le site de votre établissement depuis le bouton de Glaze dans la barre d’outils, l’onglet d’installation ou Réglages › Sites. Tout télécharger, Gradescope, les médias des Looks et les connexions réseau des mods demandent les autorisations manquantes au besoin.
• Firefox : À l’installation, Glaze demande l’accès aux domaines des plateformes instructure.com, blackboard.com et moodlecloud.com, ainsi qu’à sa galerie et à son relais de partage. Ajoutez le site de votre établissement depuis le bouton de Glaze dans la barre d’outils, l’onglet d’installation ou Réglages › Sites. Tout télécharger, Gradescope, les médias des Looks et les connexions réseau des mods demandent les autorisations manquantes au besoin.
• Moodle sur moodlecloud.com fonctionne dès l’installation.
• Les onglets de cours affichent une esquisse du cours pendant le chargement, au lieu d’une image de la page.

## store/listing-nl.md

NIEUW IN 3.4.0

• Chrome: Bij installatie vraagt Glaze toegang tot de LMS-domeinen instructure.com, blackboard.com en moodlecloud.com, en tot de eigen galerij en deelserver. Voeg de site van je school toe via de knop van Glaze in de werkbalk, het installatietabblad of Instellingen › Sites. Alles downloaden, Gradescope, Look-media en netwerkverbindingen van mods vragen waar nodig om ontbrekende toegangsrechten.
• Firefox: Bij installatie vraagt Glaze toegang tot de LMS-domeinen instructure.com, blackboard.com en moodlecloud.com, en tot de eigen galerij en deelserver. Voeg de site van je school toe via de knop van Glaze in de werkbalk, het installatietabblad of Instellingen › Sites. Alles downloaden, Gradescope, Look-media en netwerkverbindingen van mods vragen waar nodig om ontbrekende toegangsrechten.
• Moodle op moodlecloud.com werkt vanaf de installatie.
• Cursustabbladen tonen tijdens het laden een schets van de cursus in plaats van een afbeelding van de pagina.

## store/listing-pt-BR.md

NOVO NA 3.4.0

• Chrome: Na instalação, o Glaze pede acesso aos domínios das plataformas instructure.com, blackboard.com e moodlecloud.com, além da sua galeria e do seu servidor de compartilhamento. Adicione o site da sua escola pelo botão do Glaze na barra de ferramentas, pela aba de instalação ou em Configurações › Sites. Baixar tudo, Gradescope, as mídias dos Looks e as conexões de rede dos mods pedem as permissões que faltam quando precisam delas.
• Firefox: Na instalação, o Glaze pede acesso aos domínios das plataformas instructure.com, blackboard.com e moodlecloud.com, além da sua galeria e do seu servidor de compartilhamento. Adicione o site da sua escola pelo botão do Glaze na barra de ferramentas, pela aba de instalação ou em Configurações › Sites. Baixar tudo, Gradescope, as mídias dos Looks e as conexões de rede dos mods pedem as permissões que faltam quando precisam delas.
• Moodle em moodlecloud.com funciona desde a instalação.
• As abas de cursos mostram um esboço do curso enquanto carregam, em vez de uma imagem da página.
