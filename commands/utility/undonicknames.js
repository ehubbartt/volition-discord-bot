const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');

// Parse the log output to extract the nickname changes
const NICKNAME_CHANGES = `
177947797444624384|JuiceboxOS (Matt)|juiceboxos
214095743374327809|SoakedPage (Ryan)|soakedpage
217083677253959680|Nice Cahk - Jason|nice cahk
257941979499986945|Joy D Dragon|joy d dragon
558693313742503946|IV3RN (Han)|iv3rn
699309188765057120|Diddily Dee Diode|diode ex
168772123517648898|Regelios (Jonatan)|regelios
308276641371783168|DBaise|dbaise
260940787456540672|Forever FireCaper - Jake|matterhornjr
521885839408758785|Turbo Bill (Cast Turbo)|cast turbo
334782060998819852|Pervy Ninja|pervy ninja
267076157965336576|Virtsa|virtsa
243846975055855616|UnluckyDan|unluckydan
302373962686660618|Veldora BTW|veldora btw
380190346816126977|TradingIsSad|tradingissad
302816315549286400|Ph i l|ph i l
431891826970984449|dazman|dazman v2
291221162128834561|Aaron / Llandudno|llandudno
390237579267538947|Jarl BTW|jarl btw
228557475987718144|Possibly Dry|possibly dry
289609044476428288|Apex Diablos|apex diablos
209642710720577536|Rw6|rw6
225329562421035009|Herry|herry btw
290649142412181514|Solo Bad|solo bad
157744259158638592|Nutistic|nutistic
936626027336175646|Q KUMBA (JUSTIN)|q kumba
150213640782348288|False IX|false ix
356466965298020353|Gastro Guy|circum tism
259123125193670656|Liquidmorph3|liquidmorph3
493139803055849482|Cheeto|cheetog
396380613973639170|M Bx (Moog)|m bx
290475903115460609|Wotsits|wotsits
321422310143950849|KenneDIY|kennediy
183262352978870272|luker|im luker
754357233860739192|El Prawn|el prawn
1147564112159723581|Mx tty|mx tty
227031698506776576|TIIMARITAKAS (Tim)|tiimaritakas
143421746152734720|IMiDs|imids
253722221497942017|Truly|trulyobese
77458760653615104|Flared based|t o bi a s
267058712953356289|Ch1ckenGoose|ch1ckengoose
555361129489235978|Billy Bappo|billy bappo
173857611131781120|MrCleanPuss|mrcleanpuss
151191462946537472|Deep Hole|deep hole
839910778181910559|Fe Latulate (Luca)|fe latulate
329445928392196106|Tfulk|tfulkyou
267773001070673930|Raptor (YanaKuznesov)|yanakuznesov
245011357865345025|JayRobbinStacks|jayrobstacks
120891020400394240|Forcedtogim|forcedtogim
337749760016515073|Cry1|cry1
711302333497344011|Wugglybear|wugglybear
399250431831834624|Ricky2Scoops // Chris|ricky2scoops
278976379280949258|CommieFloppa|commiefloppa
175988702647025674|HumbleBoris|humbleboris
435096063221956611|Jarik | Noooo Munnie|n0000 munnie
396694300336848909|Solo Dunx|solo dunx
187360053307637760|xLovepoot|xlovepoot
153015818207100930|Pair Peach|pair peach
241963950961459201|MonkaS|itionkas
526521287091421184|Beeso|beeso
391355078176538634|Kinççç - Philkins|philkins
237613597277028353|PipeDownLads - Danny|pipedownlads
318346276213358593|Socks Off  "No clue Alex"|socks off
918623761996075008|Josh innit|josh innit
313523833040797697|God Lived (Sean)|god lived
412266929902977026|Iron Creg|iron creg
1032111963284701186|shiny witch|ShartChug (rachel)|shiny witch
563859381205336075|LittleReesie|littlereesee
647260564535377920|NichtSchwarz|nichtschwarz
705798103533617167|Breach RS (Jimmy)|breach rs
296947661066600448|FredFondu|fredfondu
684499855594356800|SevenOfNine(Erica)|msseveniron
1075258719463542845|Jack|cooking cape
124283476382842891|Draven (Alexis)|draven
425896746715971584|Nathan/Spunkdump|spunkdump
233008635100397570|Surelock|surelock98
555583758875492360|stevenr4 (StevenR4)|stevenr4
292691907170140160|Durm|durm
126678044592046080|Bertile|bertile
1076629033799925831|Ravocado|ravocado
293572164622221333|winnie IM|winnie im
244186443344379905|IamSFW|iamsfw
83583325880451072|Akis (Ben/Dusted)|akis
148895913325101068|BigDirtyHugo|bigdirtyhugo
243858044457320451|Voidmania|voidmania
226851333343281153|Grimy Pott|grimy pott
550506024763916290|SolitaryNub|solitarynub
285200683970592769|Dougieeh|vvenusaur
1178374628373180498|No Tweezers|no tweezers
361716835223339019|BTWEIRD|btweird
312902362769653761|QL Adav (Ilya)|ql adav
805585814934519838|Emilinator2|emilinator2
140792731285979136|Fe Runeboi|fe runeboi
271146786339553281|Iron Symm|iron symm
203609189354831881|Rickyburnz|rickyburnz
285178686448074752|MilkDisBussy|milkdisbussy
188451876826644480|LiamIronMan-Liam|liamironman
153004648695857153|El Marp|el marp
270357073420746762|Iron Miguel|iron miguel
144596422799392768|D0ughnutz|d0ughnutz
219855558663077888|OP-1|op 1
1135006919669600306|Awesom-O|awesomo
115175460060659713|Rye_I|rye i
180760115131973634|Bippoboyiron|bippoboyiron
175812437067431937|Cykelz|c y k e l z
204339850340597760|Mrs Forehead / Grammenz|mrs forehead
569113459401293824|IR0N Bubbles|ir0n bubbles
861042093996900362|Foster | D A D B 0 D|d a d b 0 d
230283329415413760|Smoll Floppa (Peepee)|smoll floppa
714948820424851456|Evls|evls
277919169297514497|Beenade|beenade
64228097565655040|IronGlazeRay|glazedray
159054560546127872|Project Azer|project azer
320771270767673354|3rdAgeCoifBtw(materhornjr)|materhornjr
236160708956520448|Ronny"Gotchu"|ronny gaucho
665223243388420127|Mofoka|tobbamarinos
148716750010056704|Peaced|peaced btw
213741313013710861|Kragorrr|kragorrr
1024411770443530260|Flow Lan (Scott)|flow lan
226083381354561536|NeuroFish|neurofishy
129333303714119680|Shadow Rushh|shadow rushh
201401898941677577|QQ / Get Miao Wei|get miao wei
291696307200851968|Shhoddy|shhoddy
689406850164064266|Disney|dragonpunani
109099775952961536|Bril Smurf|bril smurf
228398865085235200|TexasOhio|texasohio
154036655378923520|GREYH0UND|greyh0und
591251305410854914|Defsu|defsu
211441868314116096|Fimahz|fimahz
123721808829612032|Lego Minion|lego minion
109805986499325952|JustVibing|justvibing
280459303243087873|Greater Frog|greater frog
1383415283749748820|llX1|llx1
365423496324579339|ToastIronman|toastironman
128690367393431553|Roubam (Eamonn)|im roubam
320031746957770763|Spiffins|spiffins
422842152758804491|NeasAgain|neasagain
223182051854123010|EtherealKing|taintedmagus
247499337926574081|Vamp(BagPipe)man|vampman26
172863450085588992|D akk|d akk
303262092415336449|Pimp Joe|pimp joe
680477256216477701|Pimp Sean|pimp sean
`.trim();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('undonicknames')
        .setDescription('(Admin Only) Undo the nickname changes from /syncwomids'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const lines = NICKNAME_CHANGES.split('\n').filter(line => line.trim());
            const changes = lines.map(line => {
                const parts = line.split('|');
                return {
                    discordId: parts[0],
                    originalNickname: parts[1],
                    newNickname: parts[2]
                };
            });

            let restored = 0;
            let failed = 0;
            let output = '**Restoring original nicknames:**\n\n';

            for (const change of changes) {
                try {
                    const member = await interaction.guild.members.fetch(change.discordId);
                    await member.setNickname(change.originalNickname);
                    output += `✅ Restored <@${change.discordId}>: ${change.newNickname} → ${change.originalNickname}\n`;
                    restored++;
                    console.log(`Restored nickname for ${change.discordId}: ${change.newNickname} -> ${change.originalNickname}`);
                } catch (error) {
                    output += `❌ Failed to restore <@${change.discordId}>: ${error.message}\n`;
                    failed++;
                    console.error(`Failed to restore nickname for ${change.discordId}:`, error.message);
                }

                // Send updates in batches to avoid message length limits
                if (output.length > 1800) {
                    await interaction.followUp({ content: output });
                    output = '';
                }
            }

            if (output.length > 0) {
                await interaction.followUp({ content: output });
            }

            await interaction.followUp({
                content: `\n**Summary:**\n✅ Restored: ${restored}\n❌ Failed: ${failed}\n\nAll nicknames have been restored to their original values.`
            });

        } catch (error) {
            console.error('Error undoing nicknames:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },
};
