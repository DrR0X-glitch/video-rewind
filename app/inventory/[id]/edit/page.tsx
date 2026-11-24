import { saveTitleEdits } from "@/app/inventory/actions";
import { getMovieById } from "@/lib/data";
import { RequiredTitleMetadataFields } from "@/components/required-title-metadata-fields";

export const dynamic = "force-dynamic";

export default async function InventoryEditTitlePage(props: PageProps<"/inventory/[id]/edit">) {
  const { id } = await props.params;
  const movie = await getMovieById(id);

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Edit Title</h1>
            <p className="muted">{movie.title}</p>
          </div>
        </div>

        <form action={saveTitleEdits.bind(null, movie.id)} className="stack-form">
          <RequiredTitleMetadataFields
            titleName="title"
            sortTitleName="sortTitle"
            releaseYearName="releaseYear"
            titleDefaultValue={movie.title}
            sortTitleDefaultValue={movie.sortTitle}
            releaseYearDefaultValue={String(movie.releaseYear)}
          />
          <label>
            <span>Type</span>
            <select name="mediaType" defaultValue={movie.mediaType}>
              <option value="movie">Movie</option>
              <option value="series">Series</option>
            </select>
          </label>
          <label>
            <span>Genres</span>
            <input type="text" name="genres" defaultValue={movie.genres.join(", ")} />
          </label>
          <label>
            <span>Director / creator</span>
            <input type="text" name="director" defaultValue={movie.director} />
          </label>
          <label>
            <span>Cast</span>
            <input type="text" name="cast" defaultValue={movie.cast.join(", ")} />
          </label>
          <label>
            <span>Overview</span>
            <textarea name="overview" rows={8} defaultValue={movie.overview} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="featured" value="true" defaultChecked={movie.featured} />
            <span>Featured</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="hideFromHomepage"
              value="true"
              defaultChecked={movie.hideFromHomepage}
            />
            <span>Hide from homepage</span>
          </label>
          <button type="submit">Save Title</button>
        </form>
      </section>
    </div>
  );
}
